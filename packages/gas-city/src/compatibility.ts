/**
 * The pinned Gas City compatibility manifest.
 *
 * Factoru does not accept whatever happens to be on `PATH`. Gas City is a
 * runtime made of several independently versioned executables, and the failure
 * modes of a mismatched one are slow and confusing rather than loud: Dolt below
 * the documented floor, for example, can hang under write load instead of
 * refusing to start.
 *
 * Every version here was observed on a real installation during the Milestone 1
 * feasibility gate. When the pin moves, the gate is re-run; the numbers are not
 * edited on their own.
 */

/** A dependency Factoru requires before it will talk to Gas City. */
export interface DependencySpec {
  /** Executable name as invoked. */
  readonly command: string
  /** Human-facing name used in readiness reporting. */
  readonly displayName: string
  /**
   * Lowest version Factoru will accept. `null` means Factoru requires the
   * executable to exist but has no evidence justifying a floor, so asserting
   * one would be a guess presented as a requirement.
   */
  readonly minimumVersion: string | null
  /** Why the floor exists, so a future reader can re-evaluate it. */
  readonly reason: string
}

/**
 * The Gas City release this Factoru build was verified against.
 *
 * `gc` reports a bare semantic version from `gc version`.
 */
export const PINNED_GAS_CITY_VERSION = '1.4.0'

/**
 * Factoru accepts patch-level movement within the pinned minor. That leniency
 * is only safe because the version number is not the whole check:
 * `GasCityAdapter.verifySupervisorContract` reads the OpenAPI document the
 * running binary serves and confirms every operation Factoru depends on is
 * still present. A minor or major change re-opens the feasibility gate.
 */
export const GAS_CITY_SUPPORTED_RANGE = { minimum: '1.4.0', belowExclusive: '1.5.0' } as const

/**
 * The supervisor serves its own OpenAPI document at this path. This is the
 * authoritative contract: it is produced by the binary actually running, unlike
 * a documentation-site copy that can describe a different release. Milestone 1
 * found real divergence between the two, so Factoru reads the served document.
 */
export const SUPERVISOR_OPENAPI_PATH = '/openapi.json'

/** The API version prefix Factoru targets on the supervisor. */
export const SUPERVISOR_API_PREFIX = '/v0'

/**
 * Anti-CSRF header required on every supervisor mutation. Any non-empty value
 * is accepted; the server checks presence only. It is emphatically not
 * authorization — see `docs/ARCHITECTURE.md` security boundaries.
 */
export const GAS_CITY_REQUEST_HEADER = 'X-GC-Request'

export const REQUIRED_DEPENDENCIES: readonly DependencySpec[] = [
  {
    command: 'gc',
    displayName: 'Gas City',
    minimumVersion: PINNED_GAS_CITY_VERSION,
    reason: 'The orchestration runtime itself.',
  },
  {
    command: 'dolt',
    displayName: 'Dolt',
    minimumVersion: '2.1.0',
    reason:
      'Gas City operations documentation requires 2.1.0 or newer. Older builds miss upstream fixes and can hang during heavy writes rather than failing fast.',
  },
  {
    command: 'bd',
    displayName: 'Beads CLI',
    minimumVersion: '1.1.2',
    reason: 'Owns the bead store Gas City records all durable work in.',
  },
  {
    command: 'tmux',
    displayName: 'tmux',
    minimumVersion: null,
    reason:
      'Default session backend and always required. Gas City documents no floor and Factoru has no evidence for one.',
  },
  {
    command: 'git',
    displayName: 'Git',
    minimumVersion: null,
    reason: 'Repository access for every rig.',
  },
  {
    command: 'jq',
    displayName: 'jq',
    minimumVersion: null,
    reason: 'Used by Gas City pack scripts.',
  },
  {
    command: 'flock',
    displayName: 'flock',
    minimumVersion: null,
    reason: 'Bead store locking.',
  },
]

/** Agent harnesses Factoru supports binding a Worker Type model slot to. */
export const SUPPORTED_HARNESSES = ['claude', 'codex'] as const

export type SupportedHarness = (typeof SUPPORTED_HARNESSES)[number]
