import { z } from 'zod'

import { SUPPORTED_HARNESSES } from './compatibility.js'
import {
  advanceCursor,
  cityEventPageSchema,
  hasSequenceGap,
  selectUnhandledEvents,
  type CityEvent,
  type EventCursor,
} from './events.js'
import { GasCityError } from './errors.js'
import type { SupervisorClient } from './http.js'
import {
  checkDependencies,
  evaluateProviderReadiness,
  isReady,
  providerReadinessSchema,
  type CommandProbe,
  type ReadinessFinding,
} from './readiness.js'

/**
 * Factoru's orchestration port, implemented over Gas City.
 *
 * Everything above this file speaks Factoru's vocabulary. Gas City's wire
 * shapes are parsed here and never escape: the point of the boundary is that a
 * different orchestrator, or a different Gas City release, changes this file
 * and nothing in the product.
 */

/** A repository-backed project's Gas City binding. */
export interface RigBinding {
  readonly rigName: string
  /** Bead ID prefix Gas City assigned. Stored as an external reference only. */
  readonly beadPrefix: string | undefined
  readonly repositoryPath: string
  readonly defaultBranch: string | undefined
}

/** Where one execution of a workflow stands, in Factoru's terms. */
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface RunStep {
  readonly stepId: string
  readonly title: string
  readonly status: RunStatus
}

export interface RunSnapshot {
  readonly runId: string
  readonly workflowRootBeadId: string
  readonly steps: readonly RunStep[]
  /**
   * True when the supervisor served an incomplete answer — it reports
   * `partial` while a run projection is still warming after a restart. Callers
   * must not read an empty step list as "nothing is running".
   */
  readonly partial: boolean
}

/** The correlation Factoru persists so a run survives every process restart. */
export interface RunCorrelation {
  readonly cityName: string
  readonly rigName: string
  readonly runId: string
  readonly workflowRootBeadId: string
  readonly formulaName: string
  /**
   * Content hash of the resolved formula, recorded by Gas City on the workflow
   * root. This is the version identity: a formula file can change under the
   * same name, and a run must remain explainable afterwards.
   */
  readonly formulaHash: string | undefined
  /** Event sequence at dispatch, so observation resumes from the right place. */
  readonly startingEventSeq: number
}

const slingResultSchema = z.object({
  status: z.string().optional(),
  workflow_id: z.string(),
  root_bead_id: z.string(),
  run: z.object({ run_id: z.string(), status: z.string().optional() }).optional(),
})

const runStepsSchema = z.object({
  run_id: z.string().optional(),
  steps: z
    .array(
      z.object({ id: z.string(), title: z.string().default(''), status: z.string().default('') }),
    )
    .default([]),
  partial: z.boolean().default(false),
})

const workflowSchema = z.object({
  workflow_id: z.string(),
  root_bead_id: z.string(),
  beads: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().default(''),
        status: z.string().default(''),
        metadata: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default([]),
})

const rigListSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string(),
        prefix: z.string().nullish(),
        path: z.string().default(''),
        default_branch: z.string().nullish(),
      }),
    )
    .default([]),
})

/**
 * Map Gas City's execution vocabulary onto Factoru's.
 *
 * Unrecognised values become `unknown` rather than defaulting to a terminal
 * state: inventing "completed" for a status Factoru has not seen before would
 * move a task to Needs you on the strength of a guess.
 */
function toRunStatus(raw: string): RunStatus {
  switch (raw) {
    case 'pending':
    case 'open':
    case 'queued':
      return 'pending'
    case 'active':
    case 'in_progress':
    case 'running':
    case 'waiting':
      return 'running'
    case 'completed':
    case 'closed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'canceled':
    case 'cancelled':
    case 'canceling':
      return 'cancelled'
    default:
      return 'unknown'
  }
}

export interface GasCityAdapterOptions {
  readonly client: SupervisorClient
  /** The one city this Factoru Server owns. */
  readonly cityName: string
  /** Probes executables for readiness. */
  readonly probe: CommandProbe
}

export class GasCityAdapter {
  readonly #client: SupervisorClient
  readonly #cityName: string
  readonly #probe: CommandProbe

  constructor(options: GasCityAdapterOptions) {
    this.#client = options.client
    this.#cityName = options.cityName
    this.#probe = options.probe
  }

  get cityName(): string {
    return this.#cityName
  }

  /**
   * Report every readiness fact Factoru knows about the orchestration runtime.
   *
   * Dependency probing runs even when the supervisor is unreachable, because
   * "gc is not installed" is a far more useful answer than "connection
   * refused", and the user can act on it.
   */
  async checkReadiness(): Promise<{ ready: boolean; findings: ReadinessFinding[] }> {
    const findings = await checkDependencies(this.#probe)

    try {
      const raw = await this.#client.get(`/city/${this.#cityName}/provider-readiness`)
      findings.push(
        ...evaluateProviderReadiness(providerReadinessSchema.parse(raw), SUPPORTED_HARNESSES),
      )
    } catch (error) {
      findings.push({
        name: 'Gas City supervisor',
        status:
          error instanceof GasCityError && error.kind === 'not_found'
            ? 'missing'
            : 'needs_attention',
        detail:
          error instanceof Error
            ? error.message
            : 'The supervisor did not answer a readiness probe.',
        remedy: `Start the supervisor and the '${this.#cityName}' city on the server host.`,
      })
    }

    return { ready: isReady(findings), findings }
  }

  /** The rigs this city has registered, as Factoru-owned bindings. */
  async listRigs(): Promise<RigBinding[]> {
    const raw = await this.#client.get(`/city/${this.#cityName}/rigs`)
    return rigListSchema.parse(raw).items.map((rig) => ({
      rigName: rig.name,
      beadPrefix: rig.prefix ?? undefined,
      repositoryPath: rig.path,
      defaultBranch: rig.default_branch ?? undefined,
    }))
  }

  /**
   * Dispatch a formula as a real run and return everything Factoru must persist
   * to find it again.
   *
   * The starting event sequence is read *before* dispatch. Reading it afterwards
   * would create a window in which events fire between dispatch and the read,
   * and those events would be lost from the run's observation.
   */
  async startRun(request: {
    rigName: string
    formulaName: string
    target: string
    title: string
    variables: Readonly<Record<string, string>>
  }): Promise<RunCorrelation> {
    const startingEventSeq = await this.#currentEventSeq()

    const raw = await this.#client.post(`/city/${this.#cityName}/sling`, {
      target: request.target,
      formula: request.formulaName,
      rig: request.rigName,
      scope_kind: 'rig',
      scope_ref: request.rigName,
      title: request.title,
      vars: request.variables,
    })

    const result = slingResultSchema.parse(raw)
    const formulaHash = await this.#formulaHashFor(result.workflow_id)

    return {
      cityName: this.#cityName,
      rigName: request.rigName,
      runId: result.run?.run_id ?? result.workflow_id,
      workflowRootBeadId: result.root_bead_id,
      formulaName: request.formulaName,
      formulaHash,
      startingEventSeq,
    }
  }

  /** Current state of a run's steps. */
  async describeRun(runId: string): Promise<RunSnapshot> {
    const raw = await this.#client.get(`/city/${this.#cityName}/runs/${runId}/steps`)
    const parsed = runStepsSchema.parse(raw)

    return {
      runId,
      workflowRootBeadId: runId,
      partial: parsed.partial,
      steps: parsed.steps.map((step) => ({
        stepId: step.id,
        title: step.title,
        status: toRunStatus(step.status),
      })),
    }
  }

  /** Request cancellation. Terminal state is confirmed by observation, not here. */
  async cancelRun(runId: string): Promise<void> {
    await this.#client.post(`/city/${this.#cityName}/runs/${runId}/cancel`)
  }

  /**
   * Read events after a cursor.
   *
   * Returns the events still to handle plus the cursor to persist once their
   * effects are durable — never before, or a crash mid-handling silently skips
   * them.
   */
  async readEvents(
    cursor: EventCursor,
    limit = 200,
  ): Promise<{ events: CityEvent[]; nextCursor: EventCursor; gapDetected: boolean }> {
    const raw = await this.#client.get(`/city/${this.#cityName}/events`, {
      after_seq: cursor.lastHandledSeq,
      limit,
    })

    const page = cityEventPageSchema.parse(raw)
    const events = selectUnhandledEvents(page.items, cursor)

    return {
      events,
      nextCursor: advanceCursor(cursor, events),
      gapDetected: hasSequenceGap(page.items, cursor),
    }
  }

  async #currentEventSeq(): Promise<number> {
    const raw = await this.#client.get(`/city/${this.#cityName}/events`, { limit: 1 })
    const page = cityEventPageSchema.parse(raw)
    return page.items[0]?.seq ?? 0
  }

  /**
   * Read the resolved formula hash Gas City stamped on the workflow root.
   *
   * Best effort: the run is already dispatched and durable at this point, so
   * failing to read a diagnostic field must not turn a successful dispatch into
   * an error the caller might retry.
   */
  async #formulaHashFor(workflowId: string): Promise<string | undefined> {
    try {
      const raw = await this.#client.get(`/city/${this.#cityName}/workflow/${workflowId}`)
      const workflow = workflowSchema.parse(raw)
      const root = workflow.beads.find((bead) => bead.id === workflow.root_bead_id)
      const hash = root?.metadata['gc.formula_hash']
      return typeof hash === 'string' ? hash : undefined
    } catch {
      return undefined
    }
  }
}
