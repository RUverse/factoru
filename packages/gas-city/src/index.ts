/**
 * `@factoru/gas-city` — Factoru's orchestration port over Gas City.
 *
 * Only Factoru Server imports this package. The desktop, the renderer, and
 * `packages/domain` never do: Gas City's control plane is unauthenticated and
 * host-local, and its vocabulary is an implementation detail of orchestration
 * rather than part of Factoru's product model.
 *
 * Gas City wire shapes are parsed at this boundary and do not leave it.
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
  type GasCityAdapterOptions,
  type RigBinding,
  type RunCorrelation,
  type RunSnapshot,
  type RunStatus,
  type RunStep,
} from './adapter.js'

export {
  GasCityError,
  failureKindForStatus,
  problemToError,
  type GasCityFailureKind,
  type GasCityProblem,
} from './errors.js'

export {
  advanceCursor,
  hasSequenceGap,
  selectUnhandledEvents,
  INITIAL_EVENT_CURSOR,
  type CityEvent,
  type EventCursor,
} from './events.js'

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
  previewRigRegistration,
  type RepositoryStatusEntry,
  type RigRegistrationPreview,
} from './rig-safety.js'

export {
  compareVersions,
  parseVersion,
  satisfiesMinimum,
  withinRange,
  type ParsedVersion,
} from './version.js'
