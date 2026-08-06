/**
 * `@factoru/gas-city` — Factoru's orchestration port over Gas City.
 *
 * Only Factoru Server imports this package. The desktop, the renderer, and
 * `packages/domain` never do: Gas City's control plane is unauthenticated and
 * host-local, and its vocabulary is an implementation detail of orchestration
 * rather than part of Factoru's product model.
 *
 * Gas City wire shapes are parsed at this boundary. What leaves it is
 * deliberately narrow, but not yet zero: `CityEvent` still carries Gas City's
 * own `type`, `actor`, and `subject` vocabulary, because Milestone 1 has no
 * product event taxonomy to translate them into. Translating them belongs with
 * the domain events introduced in Milestone 2; until then this is a known,
 * bounded leak rather than a claim that none exists. Nothing outside this
 * package consumes it today.
 *
 * Status: Milestone 1 feasibility gate. Verified against Gas City 1.4.0 on
 * macOS arm64. See `docs/spikes/milestone-1-gas-city-gate.md` for what was
 * proven, what was disproven, and what remains unverified.
 */

export {
  GAS_CITY_REQUEST_HEADER,
  GAS_CITY_SUPPORTED_RANGE,
  PINNED_GAS_CITY_VERSION,
  REQUIRED_DEPENDENCIES,
  SUPERVISOR_API_PREFIX,
  SUPERVISOR_OPENAPI_PATH,
  SUPPORTED_HARNESSES,
  type DependencySpec,
  type SupportedHarness,
} from './compatibility.js'

export {
  GasCityAdapter,
  type ConversationMessage,
  type ConversationRef,
  type GasCityAdapterOptions,
  type RigBinding,
  type RunCorrelation,
  type RunSnapshot,
  type RunStatus,
  type RunStep,
} from './adapter.js'

// `problemToError` and the `GasCityProblem` shape stay internal: they are the
// wire envelope, and callers only ever need the normalised error.
export { GasCityError, type GasCityFailureKind } from './errors.js'

export {
  advanceCursor,
  hasSequenceGap,
  selectUnhandledEvents,
  INITIAL_EVENT_CURSOR,
  type CityEvent,
  type EventCursor,
} from './events.js'

// The client is exported because Factoru Server constructs it; its
// arbitrary-path methods are the cost of not hand-rolling a second one.
// Product code goes through GasCityAdapter, never through this directly.
export { SupervisorClient, isLoopbackUrl, type SupervisorClientOptions } from './http.js'

export {
  checkDependencies,
  evaluateDependency,
  evaluateProviderReadiness,
  isReady,
  type CommandProbe,
  type ProbeResult,
  type ReadinessFinding,
  type ReadinessStatus,
} from './readiness.js'

export {
  GAS_CITY_REPOSITORY_MUTATIONS,
  parsePorcelainStatus,
  parsePorcelainStatusZ,
  previewRigRegistration,
  type RepositoryStatusEntry,
  type RigRegistrationPreview,
} from './rig-safety.js'

export {
  GasCityRigRegistrar,
  type CommandExecutor,
  type RegisterProjectRigRequest,
  type RigRegistrar,
} from './registration.js'

export {
  compareVersions,
  parseVersion,
  satisfiesMinimum,
  withinRange,
  type ParsedVersion,
} from './version.js'
