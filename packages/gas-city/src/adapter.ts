import { z } from 'zod'

import { SUPERVISOR_OPENAPI_PATH, SUPPORTED_HARNESSES } from './compatibility.js'
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
export type RunStatus =
  | 'pending'
  | 'running'
  /** Waiting on an unmet `needs` edge. Distinct from pending: nothing will pick it up yet. */
  | 'blocked'
  /** Cancellation requested; not yet terminal. */
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  /** Materialised but deliberately not executed, for example a false condition. */
  | 'skipped'
  | 'unknown'

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

/**
 * Supervisor paths Factoru's operations depend on. A pinned patch release that
 * no longer serves one of these is incompatible regardless of its version
 * number.
 */
const REQUIRED_SUPERVISOR_PATHS: readonly string[] = [
  '/v0/city/{cityName}/provider-readiness',
  '/v0/city/{cityName}/rigs',
  '/v0/city/{cityName}/sling',
  '/v0/city/{cityName}/runs/{run_id}/steps',
  '/v0/city/{cityName}/runs/{run_id}/cancel',
  '/v0/city/{cityName}/workflow/{workflow_id}',
  '/v0/city/{cityName}/events',
  '/v0/city/{cityName}/events/stream',
  '/v0/city/{cityName}/usage',
  '/v0/city/{cityName}/extmsg/adapters',
  '/v0/city/{cityName}/extmsg/bind',
  '/v0/city/{cityName}/extmsg/inbound',
  '/v0/city/{cityName}/extmsg/transcript',
  '/v0/city/{cityName}/extmsg/transcript/ack',
]

const openApiSchema = z.object({
  paths: z.record(z.string(), z.unknown()),
})

// Array-valued fields are `type: ["array","null"]` throughout the 1.4.0
// contract, so every one is `.nullish()` then coerced. A Zod `.default([])`
// only fires for `undefined` and would throw on the explicit `null` the
// supervisor really sends.
const nullableArray = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((value) => value ?? [])

/**
 * One message in a Project Manager conversation, in Factoru's terms.
 *
 * `sequence` is the durable cursor: Factoru persists the highest sequence it
 * has stored, and resumes strictly after it. `GET extmsg/transcript` treats
 * `after_sequence` as strictly-greater-than, verified against 1.4.0.
 */
export interface ConversationMessage {
  readonly sequence: number
  /** `user` for a turn Factoru delivered, `assistant` for the agent's reply. */
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly authorDisplayName: string
  /** The message this replies to, when Gas City correlated one. */
  readonly inReplyToMessageId: string | undefined
  readonly createdAt: string
}

const transcriptSchema = z.object({
  items: nullableArray(
    z.object({
      Sequence: z.number().int(),
      Kind: z.string(),
      Text: z.string().default(''),
      ProviderMessageID: z.string().default(''),
      ReplyToMessageID: z.string().default(''),
      CreatedAt: z.string().default(''),
      Actor: z
        .object({ id: z.string().default(''), display_name: z.string().default('') })
        .partial()
        .default({}),
    }),
  ),
})

/** The provider name Factoru registers itself under with Gas City. */
const CONVERSATION_PROVIDER = 'factoru'

/**
 * Identifies one Factoru conversation to Gas City.
 *
 * `scopeId` is the rig, and `conversationId` is Factoru's own stable
 * conversation ID, so the mapping back to a Factoru project and conversation
 * never depends on Gas City retaining product knowledge.
 */
export interface ConversationRef {
  readonly scopeId: string
  readonly accountId: string
  readonly conversationId: string
}

function toWireConversation(conversation: ConversationRef): Record<string, string> {
  return {
    scope_id: conversation.scopeId,
    provider: CONVERSATION_PROVIDER,
    account_id: conversation.accountId,
    conversation_id: conversation.conversationId,
    // 1.4.0 accepts only dm, room, or thread. A Project Manager conversation is
    // one user talking to one agent, which is a dm.
    kind: 'dm',
  }
}

const slingResultSchema = z.object({
  status: z.string().optional(),
  workflow_id: z.string(),
  root_bead_id: z.string(),
  run: z.object({ run_id: z.string(), status: z.string().optional() }).optional(),
})

const runStepsSchema = z.object({
  run_id: z.string().optional(),
  steps: nullableArray(
    z.object({ id: z.string(), title: z.string().default(''), status: z.string().default('') }),
  ),
})

const workflowSchema = z.object({
  workflow_id: z.string(),
  root_bead_id: z.string(),
  beads: nullableArray(
    z.object({
      id: z.string(),
      title: z.string().default(''),
      status: z.string().default(''),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
})

// `RigResponse` fields are lower-snake in the served contract; `prefix` and
// `default_branch` are genuinely optional and may be null.
const rigListSchema = z.object({
  items: nullableArray(
    z.object({
      name: z.string(),
      prefix: z.string().nullish(),
      path: z.string().default(''),
      default_branch: z.string().nullish(),
    }),
  ),
  partial: z.boolean().default(false),
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
    case 'blocked':
    case 'deferred':
      return 'blocked'
    case 'completed':
    case 'closed':
      return 'completed'
    case 'failed':
      return 'failed'
    // `canceling` is a requested cancellation, not a finished one. Folding it
    // into `cancelled` would let Factoru report a run as terminal while its
    // agent is still running and still spending money.
    case 'canceling':
    case 'cancelling':
      return 'cancelling'
    case 'canceled':
    case 'cancelled':
      return 'cancelled'
    case 'skipped':
      return 'skipped'
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

  /**
   * Verify that the supervisor actually serves the operations Factoru depends
   * on, by reading the OpenAPI document it publishes.
   *
   * The version range alone is not evidence. Accepting `1.4.9` because it is
   * numerically inside `>=1.4.0 <1.5.0` assumes a patch release changed nothing
   * Factoru uses; this checks it instead. The document comes from the process
   * being talked to, so it cannot drift from it the way a published copy can.
   */
  async verifySupervisorContract(): Promise<{ ok: boolean; missingPaths: string[] }> {
    const raw = await this.#client.getAbsolute(SUPERVISOR_OPENAPI_PATH)
    const parsed = openApiSchema.parse(raw)
    const served = new Set(Object.keys(parsed.paths))
    const missingPaths = REQUIRED_SUPERVISOR_PATHS.filter((path) => !served.has(path))
    return { ok: missingPaths.length === 0, missingPaths }
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
   * Register Factoru Server as an external-message adapter.
   *
   * Idempotent by `Idempotency-Key`, because this runs on every server start
   * and re-registering must not create a second adapter identity.
   */
  async registerConversationAdapter(accountId: string, displayName: string): Promise<void> {
    await this.#client.post(
      `/city/${this.#cityName}/extmsg/adapters`,
      { provider: CONVERSATION_PROVIDER, account_id: accountId, name: displayName },
      { idempotencyKey: `factoru-adapter-${accountId}` },
    )
  }

  /**
   * Bind one Factoru conversation to a Gas City agent identity.
   *
   * The agent must be backed by a **configured named session**; 1.4.0 rejects
   * an agent binding otherwise with `invalid-request`. Named sessions are
   * city-scoped — `[[named_session]]` has no `rig` field and a rig-qualified
   * template name fails validation — so per-project isolation comes from giving
   * each project its own named-session-backed identity, not from rig scoping.
   */
  async bindConversation(conversation: ConversationRef, agentName: string): Promise<void> {
    await this.#client.post(`/city/${this.#cityName}/extmsg/bind`, {
      agent_name: agentName,
      conversation: toWireConversation(conversation),
    })
  }

  /** Deliver one user turn. The reply arrives on the transcript, not here. */
  async sendConversationTurn(
    conversation: ConversationRef,
    turn: {
      messageId: string
      text: string
      authorId: string
      authorDisplayName: string
      receivedAt: string
    },
  ): Promise<void> {
    await this.#client.post(`/city/${this.#cityName}/extmsg/inbound`, {
      message: {
        provider_message_id: turn.messageId,
        conversation: toWireConversation(conversation),
        actor: { id: turn.authorId, display_name: turn.authorDisplayName, is_bot: false },
        text: turn.text,
        received_at: turn.receivedAt,
      },
    })
  }

  /**
   * Read conversation messages after a sequence.
   *
   * `after_sequence` is strictly-greater-than, verified against 1.4.0. Every
   * conversation field including `kind` must be supplied: omitting `kind`
   * returns a 500 rather than a validation error, so a partially-built query
   * fails as an unexplained server fault.
   */
  async readConversation(
    conversation: ConversationRef,
    afterSequence: number,
    limit = 100,
  ): Promise<ConversationMessage[]> {
    const raw = await this.#client.get(`/city/${this.#cityName}/extmsg/transcript`, {
      ...toWireConversation(conversation),
      after_sequence: afterSequence,
      limit,
    })

    return transcriptSchema
      .parse(raw)
      .items.map((entry) => ({
        sequence: entry.Sequence,
        role: entry.Kind === 'inbound' ? ('user' as const) : ('assistant' as const),
        text: entry.Text,
        authorDisplayName: entry.Actor.display_name ?? '',
        inReplyToMessageId: entry.ReplyToMessageID || undefined,
        createdAt: entry.CreatedAt,
      }))
      .sort((a, b) => a.sequence - b.sequence)
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

  /**
   * Current state of a run's steps.
   *
   * The caller supplies the workflow root bead ID it persisted at dispatch.
   * Gas City's sling response reports `run_id`, `workflow_id`, and
   * `root_bead_id` separately, so the adapter must not assume they are the same
   * value — they happen to coincide for a standalone sling and would diverge
   * silently otherwise.
   */
  async describeRun(runId: string, workflowRootBeadId: string): Promise<RunSnapshot> {
    const raw = await this.#client.get(`/city/${this.#cityName}/runs/${runId}/steps`)
    const parsed = runStepsSchema.parse(raw)

    return {
      runId,
      workflowRootBeadId,
      // `RunStepsOutputBody` carries no `partial` field; only the aggregated
      // list endpoints do. An empty step list here therefore means the run
      // projection is still warming, which is not the same as "no steps".
      partial: parsed.steps.length === 0,
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
   * Read every event after a cursor.
   *
   * `GET /events` has **no `after_seq` parameter** — it returns the newest page
   * and pages backwards through an opaque `next_cursor`. Only `/events/stream`
   * accepts `after_seq`. So a resume cannot ask the server for "everything
   * after N"; it must walk back from the head until it reaches N.
   *
   * Getting this wrong is silent and permanent: reading one newest page and
   * advancing the cursor to its highest sequence skips everything in between,
   * and the skipped events are never revisited because the cursor only moves
   * forward.
   *
   * `maxPages` bounds the walk so a cursor left far behind cannot turn into an
   * unbounded read. Exhausting it is reported as a gap, because the caller is
   * then in exactly the position a gap describes: it cannot prove continuity
   * and must reconcile authoritative state.
   */
  async readEvents(
    cursor: EventCursor,
    options: { pageSize?: number; maxPages?: number } = {},
  ): Promise<{ events: CityEvent[]; nextCursor: EventCursor; gapDetected: boolean }> {
    const pageSize = options.pageSize ?? 200
    const maxPages = options.maxPages ?? 20

    const collected: CityEvent[] = []
    let pageCursor: string | undefined
    let oldestSeen: number | undefined
    let reachedCursor = false

    for (let page = 0; page < maxPages; page += 1) {
      const raw = await this.#client.get(`/city/${this.#cityName}/events`, {
        limit: pageSize,
        cursor: pageCursor,
      })
      const parsed = cityEventPageSchema.parse(raw)
      if (parsed.items.length === 0) {
        // No more history at all: everything that exists has been seen.
        reachedCursor = true
        break
      }

      collected.push(...parsed.items)
      for (const event of parsed.items) {
        if (oldestSeen === undefined || event.seq < oldestSeen) oldestSeen = event.seq
      }

      // Walked back far enough to touch already-handled history.
      if (oldestSeen !== undefined && oldestSeen <= cursor.lastHandledSeq + 1) {
        reachedCursor = true
        break
      }

      if (!parsed.next_cursor) {
        // Reached the oldest retained event. Whether that is a gap depends on
        // how far back it goes, which hasSequenceGap decides below.
        break
      }
      pageCursor = parsed.next_cursor
    }

    const events = selectUnhandledEvents(collected, cursor)

    return {
      events,
      nextCursor: advanceCursor(cursor, events),
      // Only meaningful now that pagination is finished.
      gapDetected: !reachedCursor && hasSequenceGap(oldestSeen, cursor),
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
