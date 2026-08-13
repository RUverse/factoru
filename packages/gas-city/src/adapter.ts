import { createHash } from 'node:crypto'
import { z } from 'zod'

import { SUPERVISOR_OPENAPI_PATH, SUPPORTED_HARNESSES } from './compatibility.js'
import {
  advanceCursor,
  cityEventSchema,
  cityEventPageSchema,
  hasSequenceGap,
  selectUnhandledEvents,
  type CityEvent,
  type EventCursor,
} from './events.js'
import { GasCityError } from './errors.js'
import { isLoopbackUrl, type SupervisorClient } from './http.js'
import {
  serializeFormulaVariables,
  validateFormulaV2,
  type FormulaVariableValue,
} from './formula.js'
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

/** Browser-safe model choices exposed by one configured provider. */
export interface ModelProvider {
  readonly id: string
  readonly name: string
  readonly defaultModelId: string | null
  readonly models: readonly {
    readonly id: string
    readonly name: string
  }[]
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

export interface FormulaPreview {
  readonly name: string
  readonly stages: readonly { id: string; title: string; kind: string }[]
  readonly edges: readonly { from: string; to: string }[]
}

export interface NativeRunSnapshot extends RunSnapshot {
  readonly convoyId: string | undefined
  readonly units: readonly {
    id: string
    title: string
    status: RunStatus
    dependencyIds: readonly string[]
    sessionId: string | undefined
  }[]
  readonly sessions: readonly {
    id: string
    purpose:
      | 'implementation'
      | 'correctness_testing'
      | 'security_reliability'
      | 'maintainability_architecture'
      | 'review_synthesis'
      | 'correction'
    status: RunStatus
    transcript: readonly {
      sequence: number
      role: 'user' | 'assistant' | 'tool' | 'system'
      text: string
      createdAt: string
    }[]
  }[]
}

export interface RunUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly estimatedCostUsd: number
  /** Whether a dollar estimate exists for every observed model invocation. */
  readonly pricing: 'pending' | 'priced' | 'unpriced'
  readonly partial: boolean
}

export type RunUsageStreamFrame =
  | {
      readonly kind: 'event'
      readonly seq: number
      readonly delta:
        | {
            readonly runId: string
            readonly inputTokens: number
            readonly outputTokens: number
            readonly estimatedCostUsd: number
            readonly pricing: 'pending' | 'priced' | 'unpriced'
          }
        | undefined
    }
  | { readonly kind: 'heartbeat' }

/** The correlation Factoru persists so a run survives every process restart. */
export interface RunCorrelation {
  readonly cityName: string
  readonly rigName: string
  readonly runId: string
  readonly workflowId?: string
  readonly workflowRootBeadId: string
  readonly formulaName: string
  /**
   * Content hash of the resolved formula, recorded by Gas City on the workflow
   * root. This is the version identity: a formula file can change under the
   * same name, and a run must remain explainable afterwards.
   */
  readonly formulaHash: string | undefined
  /** Factoru-owned source bead used by attached formula launches. */
  readonly sourceBeadId?: string
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
  '/v0/city/{cityName}/providers/public',
  '/v0/city/{cityName}/rigs',
  '/v0/city/{cityName}/beads',
  '/v0/city/{cityName}/formulas/{name}/preview',
  '/v0/city/{cityName}/sling',
  '/v0/city/{cityName}/runs/{run_id}/steps',
  '/v0/city/{cityName}/runs/{run_id}/cancel',
  '/v0/city/{cityName}/workflow/{workflow_id}',
  '/v0/city/{cityName}/events',
  '/v0/city/{cityName}/events/stream',
  '/v0/city/{cityName}/extmsg/adapters',
  '/v0/city/{cityName}/extmsg/bind',
  '/v0/city/{cityName}/extmsg/inbound',
  '/v0/city/{cityName}/extmsg/outbound',
  '/v0/city/{cityName}/extmsg/transcript',
  '/v0/city/{cityName}/extmsg/transcript/ack',
  '/v0/city/{cityName}/session/{id}/transcript',
  '/v0/city/{cityName}/session/{id}/close',
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
  /** The stable provider identifier supplied by Factoru for inbound turns. */
  readonly providerMessageId: string | undefined
  /** `user` for a turn Factoru delivered, `assistant` for the agent's reply. */
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly authorDisplayName: string
  /** The message this replies to, when Gas City correlated one. */
  readonly inReplyToMessageId: string | undefined
  readonly createdAt: string
}

export interface ConversationAttachment {
  readonly providerId: string
  readonly url: string
  readonly mimeType: string
}

export interface ConversationDelivery {
  readonly sessionId: string
}

export interface ConversationProjection {
  readonly providerMessageId: string
  readonly status: 'partial' | 'final'
  readonly text: string
  readonly tools: readonly {
    readonly id: string
    readonly name: string
    readonly status: 'running' | 'completed' | 'failed'
    readonly summary: string
  }[]
  readonly inputTokens: number
  readonly outputTokens: number
  readonly createdAt: string | undefined
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

const beadSchema = z.object({ id: z.string(), status: z.string().optional() })

const formulaPreviewSchema = z.object({
  name: z.string(),
  steps: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      metadata: z.record(z.string(), z.string()).default({}),
    }),
  ),
  deps: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
})

function formulaPreview(raw: unknown): FormulaPreview {
  const preview = formulaPreviewSchema.parse(raw)
  return {
    name: preview.name,
    stages: preview.steps.map((step) => ({
      id: step.id,
      title: step.metadata['title'] ?? step.id,
      kind: step.kind,
    })),
    edges: preview.deps,
  }
}

const runStepsSchema = z.object({
  run_id: z.string().optional(),
  steps: nullableArray(
    z.object({ id: z.string(), title: z.string().default(''), status: z.string().default('') }),
  ),
})

const operationUsageSchema = z.object({
  run_id: z.string().optional(),
  session_id: z.string().optional(),
  prompt_tokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(),
  cost_usd_estimate: z.number().nonnegative().optional(),
  unpriced: z.boolean().optional(),
})

const structuredTranscriptSchema = z.object({
  provider: z.string(),
  format: z.literal('structured'),
  structured_messages: nullableArray(
    z.object({
      id: z.string().default(''),
      role: z.string().default(''),
      status: z.enum(['unknown', 'final', 'partial', 'superseded']).default('unknown'),
      timestamp: z.string().nullish(),
      blocks: nullableArray(
        z.object({
          type: z.string().default(''),
          text: z.string().nullish(),
          content: z.string().nullish(),
          id: z.string().nullish(),
          tool_call_id: z.string().nullish(),
          name: z.string().nullish(),
          is_error: z.boolean().nullish(),
          structured: z
            .object({
              kind: z.string().nullish(),
              text: z.string().nullish(),
              stdout: z.string().nullish(),
              stderr: z.string().nullish(),
              output: z.string().nullish(),
              description: z.string().nullish(),
            })
            .passthrough()
            .nullish(),
        }),
      ),
      usage: z
        .object({
          input_tokens: z.number().int().nonnegative().default(0),
          output_tokens: z.number().int().nonnegative().default(0),
        })
        .nullish(),
    }),
  ),
})

const inboundResultSchema = z.object({ target_session_id: z.string().min(1) })

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

// Gas City deliberately removes provider CLI flags and environment details
// from this public projection. Factoru consumes only configured city entries
// and the model option's safe value/label pairs plus effective default.
const providerPublicListSchema = z.object({
  items: nullableArray(
    z.object({
      name: z.string(),
      display_name: z.string().default(''),
      builtin: z.boolean().default(false),
      city_level: z.boolean().default(false),
      effective_defaults: z.record(z.string(), z.string()).default({}),
      options_schema: nullableArray(
        z.object({
          key: z.string(),
          label: z.string().default(''),
          type: z.string().default(''),
          default: z.string().default(''),
          choices: nullableArray(
            z.object({
              value: z.string(),
              label: z.string().default(''),
            }),
          ),
        }),
      ),
    }),
  ),
  total: z.number().int().nonnegative().optional(),
  next_cursor: z.string().optional(),
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
  /** Resolves the exact pinned source Factoru validates before dispatch. */
  readonly formulaSource?: (formulaName: string) => Promise<string>
}

export interface InheritedFormulaCapabilityPolicy {
  readonly maxImplementationUnits: number
  readonly drainContext: 'shared'
  readonly requiredStepIds: readonly string[]
  readonly requiredEdges: readonly (readonly [from: string, to: string])[]
}

function semanticStepMatches(compiledId: string, semanticId: string): boolean {
  return compiledId === semanticId || compiledId.endsWith(`.${semanticId}`)
}

function validateInheritedFormulaPreview(
  raw: unknown,
  formulaName: string,
  policy: InheritedFormulaCapabilityPolicy,
): void {
  const preview = formulaPreviewSchema.parse(raw)
  if (preview.name !== formulaName) {
    throw new GasCityError('Inherited formula preview resolved the wrong formula', {
      kind: 'invalid_request',
    })
  }
  for (const required of policy.requiredStepIds) {
    if (!preview.steps.some((step) => semanticStepMatches(step.id, required))) {
      throw new GasCityError(`Inherited formula is missing required step ${required}`, {
        kind: 'invalid_request',
      })
    }
  }
  for (const [from, to] of policy.requiredEdges) {
    if (
      !preview.deps.some(
        (edge) => semanticStepMatches(edge.from, from) && semanticStepMatches(edge.to, to),
      )
    ) {
      throw new GasCityError(`Inherited formula is missing required dependency ${from} -> ${to}`, {
        kind: 'invalid_request',
      })
    }
  }
  if (preview.steps.some((step) => step.kind === 'gate' || step.kind === 'wait')) {
    throw new GasCityError('Inherited formula requires an interactive or waiting gate', {
      kind: 'invalid_request',
    })
  }
  const drains = preview.steps.filter((step) => step.kind === 'drain')
  if (drains.length === 0) {
    throw new GasCityError('Inherited formula has no bounded implementation drain', {
      kind: 'invalid_request',
    })
  }
  for (const drain of drains) {
    const rawMaxUnits = drain.metadata['gc.drain_max_units'] ?? ''
    const maxUnits = /^\d+$/.test(rawMaxUnits) ? Number(rawMaxUnits) : Number.NaN
    if (
      drain.metadata['gc.drain_context'] !== policy.drainContext ||
      !Number.isInteger(maxUnits) ||
      maxUnits < 1 ||
      maxUnits > policy.maxImplementationUnits ||
      drain.metadata['gc.drain_item_single_lane'] !== 'true'
    ) {
      throw new GasCityError('Inherited formula violates the preset drain capability policy', {
        kind: 'invalid_request',
      })
    }
  }
}

export class GasCityAdapter {
  readonly #client: SupervisorClient
  readonly #cityName: string
  readonly #probe: CommandProbe
  readonly #formulaSource: GasCityAdapterOptions['formulaSource']

  constructor(options: GasCityAdapterOptions) {
    this.#client = options.client
    this.#cityName = options.cityName
    this.#probe = options.probe
    this.#formulaSource = options.formulaSource
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
  async checkReadiness(
    requiredHarnesses: readonly string[] = SUPPORTED_HARNESSES,
  ): Promise<{ ready: boolean; findings: ReadinessFinding[] }> {
    const findings = await checkDependencies(this.#probe)

    try {
      const providers = await this.checkProviderReadiness(requiredHarnesses)
      findings.push(...providers.findings)
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
   * Read only the city-scoped provider state for operator diagnostics.
   *
   * This remains behind the adapter because the supervisor response is Gas
   * City vocabulary. Factoru's CLI receives the same normalized findings used
   * by startup readiness rather than parsing a second wire shape.
   */
  async checkProviderReadiness(
    requiredHarnesses: readonly string[] = SUPPORTED_HARNESSES,
  ): Promise<{ ready: boolean; findings: ReadinessFinding[] }> {
    const raw = await this.#client.get(`/city/${this.#cityName}/provider-readiness`)
    const findings = evaluateProviderReadiness(
      providerReadinessSchema.parse(raw),
      requiredHarnesses,
    )
    return { ready: isReady(findings), findings }
  }

  /**
   * Load the safe model picker metadata for providers declared by this city.
   *
   * Built-ins that are merely available in Gas City are excluded: a Team slot
   * may bind only to an explicitly configured city provider. Provider launch
   * flags and credentials are intentionally absent from this endpoint.
   */
  async listModelProviders(): Promise<ModelProvider[]> {
    const raw = await this.#client.get(`/city/${this.#cityName}/providers/public`)
    const providers = providerPublicListSchema.parse(raw).items

    return providers.flatMap((provider) => {
      if (!provider.city_level) return []
      const modelOption = provider.options_schema.find(
        (option) => option.key === 'model' && option.type === 'select',
      )
      if (!modelOption) return []

      const models = [
        ...new Map(
          modelOption.choices
            .filter((choice) => choice.value.trim().length > 0)
            .map((choice) => [
              choice.value,
              { id: choice.value, name: choice.label || choice.value },
            ]),
        ).values(),
      ]
      if (models.length === 0) return []
      const configuredDefault = provider.effective_defaults.model || modelOption.default
      const effectiveDefault = models.some((model) => model.id === configuredDefault)
        ? configuredDefault
        : models[0]!.id

      return [
        {
          id: provider.name,
          name: provider.display_name || provider.name,
          defaultModelId: effectiveDefault,
          models,
        },
      ]
    })
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
  async registerConversationAdapter(
    accountId: string,
    displayName: string,
    callbackUrl?: string,
  ): Promise<void> {
    if (callbackUrl && !isLoopbackUrl(callbackUrl)) {
      throw new GasCityError('Factoru conversation callbacks must use a loopback URL', {
        kind: 'invalid_request',
      })
    }
    const callbackIdentity = callbackUrl ?? 'poll-only'
    const registrationKey = createHash('sha256').update(callbackIdentity).digest('hex').slice(0, 16)
    await this.#client.post(
      `/city/${this.#cityName}/extmsg/adapters`,
      {
        provider: CONVERSATION_PROVIDER,
        account_id: accountId,
        name: displayName,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      },
      { idempotencyKey: `factoru-adapter-${accountId}-${registrationKey}` },
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
      attachments?: readonly ConversationAttachment[]
    },
  ): Promise<ConversationDelivery> {
    const raw = await this.#client.post(`/city/${this.#cityName}/extmsg/inbound`, {
      message: {
        provider_message_id: turn.messageId,
        conversation: toWireConversation(conversation),
        actor: { id: turn.authorId, display_name: turn.authorDisplayName, is_bot: false },
        text: turn.text,
        received_at: turn.receivedAt,
        attachments: (turn.attachments ?? []).map((attachment) => ({
          provider_id: attachment.providerId,
          url: attachment.url,
          mime_type: attachment.mimeType,
        })),
      },
    })
    const result = inboundResultSchema.parse(raw)
    return { sessionId: result.target_session_id }
  }

  /** Read Gas City's provider-neutral projection for a live assistant turn. */
  async readConversationProjection(sessionId: string): Promise<ConversationProjection | null> {
    const raw = await this.#client.get(
      `/city/${this.#cityName}/session/${encodeURIComponent(sessionId)}/transcript`,
      { format: 'structured', tail: 0 },
    )
    const transcript = structuredTranscriptSchema.parse(raw)
    const message = [...transcript.structured_messages]
      .reverse()
      .find((candidate) => candidate.role === 'assistant' && candidate.status !== 'superseded')
    if (!message) return null

    const results = new Map<string, { failed: boolean; summary: string }>()
    for (const block of transcript.structured_messages.flatMap((candidate) => candidate.blocks)) {
      if (block.type !== 'tool_result') continue
      const summary =
        block.content ??
        block.text ??
        block.structured?.output ??
        block.structured?.stdout ??
        block.structured?.stderr ??
        block.structured?.text ??
        ''
      results.set(block.tool_call_id ?? block.id ?? '', {
        failed: block.is_error === true,
        summary,
      })
    }
    const tools = message.blocks
      .filter((block) => block.type === 'tool_use' || block.type === 'tool_call')
      .map((block, index) => {
        const id = block.id ?? block.tool_call_id ?? `${message.id}:tool:${index}`
        const result = results.get(id)
        return {
          id,
          name: block.name ?? block.structured?.description ?? 'Tool',
          status: result
            ? result.failed
              ? ('failed' as const)
              : ('completed' as const)
            : ('running' as const),
          summary: result?.summary ?? '',
        }
      })
    const text = message.blocks
      .filter((block) => block.type === 'text' || block.type === 'output_text')
      .map((block) => block.text ?? block.content ?? block.structured?.text ?? '')
      .join('')

    return {
      providerMessageId: message.id || sessionId,
      status: message.status === 'final' ? 'final' : 'partial',
      text,
      tools,
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      createdAt: message.timestamp ?? undefined,
    }
  }

  /** Request cancellation of the named provider session serving this turn. */
  async cancelConversationTurn(sessionId: string): Promise<void> {
    await this.#client.post(
      `/city/${this.#cityName}/session/${encodeURIComponent(sessionId)}/close`,
    )
  }

  /** Close the provider session so the next inbound turn starts with clean context. */
  async resetConversationContext(sessionId: string): Promise<void> {
    await this.cancelConversationTurn(sessionId)
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
        providerMessageId: entry.ProviderMessageID || undefined,
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
    variables: Readonly<Record<string, FormulaVariableValue>>
    requestId?: string
    launchMode?: 'standalone' | 'attached'
    capabilityPolicy?: InheritedFormulaCapabilityPolicy
    sourceBead?: {
      description: string
      labels?: readonly string[]
      metadata: Readonly<Record<string, string>>
      priority?: number
    }
  }): Promise<RunCorrelation> {
    const launchMode = request.launchMode ?? 'standalone'
    if (launchMode === 'attached') {
      if (!request.sourceBead) {
        throw new GasCityError('Attached workflow launch requires source bead metadata', {
          kind: 'invalid_request',
        })
      }
      if (!request.capabilityPolicy) {
        throw new GasCityError('Attached workflow launch requires a capability policy', {
          kind: 'invalid_request',
        })
      }
      const preview = await this.#client.post(
        `/city/${this.#cityName}/formulas/${request.formulaName}/preview`,
        {
          scope_kind: 'rig',
          scope_ref: request.rigName,
          target: request.target,
          vars: serializeFormulaVariables(request.variables),
        },
      )
      validateInheritedFormulaPreview(preview, request.formulaName, request.capabilityPolicy)
    } else if (this.#formulaSource) {
      validateFormulaV2(
        await this.#formulaSource(request.formulaName),
        request.formulaName,
        request.variables,
      )
    }
    const startingEventSeq = await this.#currentEventSeq()
    const sourceBead =
      launchMode === 'attached'
        ? beadSchema.parse(
            await this.#client.post(
              `/city/${this.#cityName}/beads`,
              {
                rig: request.rigName,
                title: request.title,
                type: 'feature',
                description: request.sourceBead!.description,
                labels: [...(request.sourceBead!.labels ?? [])],
                metadata: request.sourceBead!.metadata,
                ...(request.sourceBead!.priority === undefined
                  ? {}
                  : { priority: request.sourceBead!.priority }),
              },
              { idempotencyKey: `${request.requestId ?? request.title}:source` },
            ),
          )
        : undefined

    const raw = await this.#client.post(
      `/city/${this.#cityName}/sling`,
      {
        target: request.target,
        formula: request.formulaName,
        ...(sourceBead ? { attached_bead_id: sourceBead.id } : {}),
        rig: request.rigName,
        scope_kind: 'rig',
        scope_ref: request.rigName,
        title: request.title,
        vars: serializeFormulaVariables(request.variables),
      },
      { idempotencyKey: request.requestId },
    )

    const result = slingResultSchema.parse(raw)
    const formulaHash = await this.#formulaHashFor(result.workflow_id)

    return {
      cityName: this.#cityName,
      rigName: request.rigName,
      runId: result.run?.run_id ?? result.workflow_id,
      workflowId: result.workflow_id,
      workflowRootBeadId: result.root_bead_id,
      formulaName: request.formulaName,
      formulaHash,
      sourceBeadId: sourceBead?.id,
      startingEventSeq,
    }
  }

  async previewFormula(request: {
    rigName: string
    formulaName: string
    target: string
    variables: Readonly<Record<string, FormulaVariableValue>>
  }): Promise<FormulaPreview> {
    const raw = await this.#client.post(
      `/city/${this.#cityName}/formulas/${request.formulaName}/preview`,
      {
        scope_kind: 'rig',
        scope_ref: request.rigName,
        target: request.target,
        vars: serializeFormulaVariables(request.variables),
      },
    )
    return formulaPreview(raw)
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

  /**
   * Rebuild a detailed projection from 1.4.0's authoritative workflow, event,
   * and provider-neutral transcript reads. Event delivery is the fast path;
   * this method deliberately remains sufficient after a cursor gap or server
   * restart.
   */
  async describeNativeRun(
    runId: string,
    workflowId: string,
    workflowRootBeadId: string,
  ): Promise<NativeRunSnapshot> {
    const [snapshot, workflowRaw] = await Promise.all([
      this.describeRun(runId, workflowRootBeadId),
      this.#client.get(`/city/${this.#cityName}/workflow/${encodeURIComponent(workflowId)}`),
    ])
    const workflow = workflowSchema.parse(workflowRaw)
    const sessionBeads = workflow.beads.filter((bead) => {
      const session = bead.metadata['gc.session_id']
      return typeof session === 'string' && session.length > 0
    })
    const sessions = await Promise.all(
      sessionBeads.slice(0, 32).map(async (bead) => {
        const sessionId = String(bead.metadata['gc.session_id'])
        const raw = await this.#client.get(
          `/city/${this.#cityName}/session/${encodeURIComponent(sessionId)}/transcript`,
          { format: 'structured', tail: 40 },
        )
        const transcript = structuredTranscriptSchema.parse(raw)
        const identity = `${bead.id} ${bead.title}`.toLocaleLowerCase()
        const purpose =
          identity.includes('correctness') || identity.includes('testing')
            ? ('correctness_testing' as const)
            : identity.includes('security') || identity.includes('reliability')
              ? ('security_reliability' as const)
              : identity.includes('maintainability') || identity.includes('architecture')
                ? ('maintainability_architecture' as const)
                : identity.includes('synth')
                  ? ('review_synthesis' as const)
                  : identity.includes('correct')
                    ? ('correction' as const)
                    : ('implementation' as const)
        return {
          id: sessionId,
          purpose,
          status: toRunStatus(bead.status),
          transcript: transcript.structured_messages.slice(-40).map((message, sequence) => {
            const role: 'user' | 'assistant' | 'tool' | 'system' =
              message.role === 'assistant' || message.role === 'user'
                ? message.role
                : message.role === 'tool'
                  ? 'tool'
                  : 'system'
            return {
              sequence,
              role,
              text: message.blocks
                .map((block) => block.text ?? block.content ?? block.structured?.text ?? '')
                .filter(Boolean)
                .join('\n')
                .slice(0, 4_096),
              createdAt: message.timestamp ?? '1970-01-01T00:00:00.000Z',
            }
          }),
        }
      }),
    )
    const unitBeads = workflow.beads.filter((bead) => {
      const kind = bead.metadata['gc.kind'] ?? bead.metadata['gc.step_kind']
      return kind === 'drain_item' || bead.metadata['gc.drain_item'] === true
    })
    const convoyId = workflow.beads
      .map((bead) => bead.metadata['gc.convoy_id'])
      .find((value): value is string => typeof value === 'string' && value.length > 0)
    return {
      ...snapshot,
      convoyId,
      units: unitBeads.slice(0, 20).map((bead) => ({
        id: bead.id,
        title: bead.title || bead.id,
        status: toRunStatus(bead.status),
        dependencyIds: Array.isArray(bead.metadata['needs'])
          ? bead.metadata['needs'].filter((value): value is string => typeof value === 'string')
          : [],
        sessionId:
          typeof bead.metadata['gc.session_id'] === 'string'
            ? bead.metadata['gc.session_id']
            : undefined,
      })),
      sessions,
    }
  }

  /** Stream normalized per-run usage deltas while preserving every city seq. */
  async *streamRunUsageEvents(
    afterEventSeq: number,
    signal: AbortSignal,
  ): AsyncGenerator<RunUsageStreamFrame> {
    for await (const frame of this.#client.stream(
      `/city/${this.#cityName}/events/stream`,
      { after_seq: afterEventSeq },
      signal,
    )) {
      if (frame.event === 'heartbeat') {
        yield { kind: 'heartbeat' }
        continue
      }
      if (frame.event !== 'event' && frame.event !== 'message') continue
      let decoded: unknown
      try {
        decoded = JSON.parse(frame.data) as unknown
      } catch (cause) {
        throw new GasCityError('Gas City emitted malformed JSON on its city event stream', {
          kind: 'transport',
          cause,
        })
      }
      const event = cityEventSchema.parse(decoded)
      let delta: Extract<RunUsageStreamFrame, { kind: 'event' }>['delta']
      if (event.type === 'worker.operation') {
        const parsed = operationUsageSchema.safeParse(event.payload)
        if (parsed.success && parsed.data.run_id) {
          const observedTokens =
            (parsed.data.prompt_tokens ?? 0) + (parsed.data.completion_tokens ?? 0)
          delta = {
            runId: parsed.data.run_id,
            inputTokens: parsed.data.prompt_tokens ?? 0,
            outputTokens: parsed.data.completion_tokens ?? 0,
            estimatedCostUsd: parsed.data.cost_usd_estimate ?? 0,
            pricing:
              observedTokens === 0
                ? 'pending'
                : parsed.data.unpriced === true
                  ? 'unpriced'
                  : parsed.data.unpriced === false || parsed.data.cost_usd_estimate !== undefined
                    ? 'priced'
                    : 'unpriced',
          }
        }
      }
      yield { kind: 'event', seq: event.seq, delta }
    }
  }

  /** Full structured-transcript fallback for sessions without usage events. */
  async readTranscriptUsage(sessionIds: readonly string[]): Promise<RunUsage> {
    let inputTokens = 0
    let outputTokens = 0
    let transcriptPartial = false
    for (const sessionId of new Set(sessionIds)) {
      try {
        const raw = await this.#client.get(
          `/city/${this.#cityName}/session/${encodeURIComponent(sessionId)}/transcript`,
          { format: 'structured', tail: 0 },
        )
        const transcript = structuredTranscriptSchema.parse(raw)
        for (const message of transcript.structured_messages) {
          if (!message.usage) continue
          inputTokens += message.usage.input_tokens
          outputTokens += message.usage.output_tokens
        }
      } catch {
        transcriptPartial = true
      }
    }
    return {
      inputTokens,
      outputTokens,
      estimatedCostUsd: 0,
      pricing: inputTokens > 0 || outputTokens > 0 ? 'unpriced' : 'pending',
      partial: transcriptPartial,
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
