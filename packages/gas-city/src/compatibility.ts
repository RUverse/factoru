/**
 * The pinned Gas City compatibility manifest.
 *
 * Factoru does not accept whatever happens to be on `PATH`. Gas City is a
 * runtime made of several independently versioned executables, and the failure
 * modes of a mismatched one are slow and confusing rather than loud: Dolt below
 * the documented floor, for example, can hang under write load instead of
 * refusing to start.
 *
 * Compatibility floors were observed during the feasibility and production
 * gates. Exact source-bootstrap releases may move to a later compatible patch;
 * every move requires verified Linux artifacts and proportionate tests.
 */

/** A dependency Factoru requires before it will talk to Gas City. */
export interface DependencySpec {
  /** Executable name as invoked. */
  readonly command: string
  /** Arguments that print this executable's version. */
  readonly versionArgs: readonly string[]
  /** Human-facing name used in readiness reporting. */
  readonly displayName: string
  /**
   * Lowest version Factoru will accept. `null` means Factoru requires the
   * executable to exist but has no evidence justifying a floor, so asserting
   * one would be a guess presented as a requirement.
   */
  readonly minimumVersion: string | null
  /** Exact release installed by the source-preview bootstrap, when Factoru owns it. */
  readonly installVersion: string | null
  /** Why the floor exists, so a future reader can re-evaluate it. */
  readonly reason: string
}

export type LinuxArtifactArchitecture = 'amd64' | 'arm64'

export interface SourceBootstrapArtifact {
  readonly command: 'gc' | 'dolt' | 'bd'
  readonly version: string
  readonly repository: string
  readonly fileNames: Readonly<Record<LinuxArtifactArchitecture, string>>
  readonly sha256: Readonly<Record<LinuxArtifactArchitecture, string>>
}

/**
 * The Gas City release this Factoru build was verified against.
 *
 * `gc` reports a bare semantic version from `gc version`.
 */
export const PINNED_GAS_CITY_VERSION = '1.4.0'
export const PINNED_DOLT_INSTALL_VERSION = '2.1.7'
export const PINNED_BEADS_INSTALL_VERSION = '1.1.2'

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
    versionArgs: ['version'],
    displayName: 'Gas City',
    minimumVersion: PINNED_GAS_CITY_VERSION,
    installVersion: PINNED_GAS_CITY_VERSION,
    reason: 'The orchestration runtime itself.',
  },
  {
    command: 'dolt',
    versionArgs: ['version'],
    displayName: 'Dolt',
    minimumVersion: '2.1.0',
    installVersion: PINNED_DOLT_INSTALL_VERSION,
    reason:
      'Gas City operations documentation requires 2.1.0 or newer. Older builds miss upstream fixes and can hang during heavy writes rather than failing fast.',
  },
  {
    command: 'bd',
    versionArgs: ['version'],
    displayName: 'Beads CLI',
    minimumVersion: '1.1.2',
    installVersion: PINNED_BEADS_INSTALL_VERSION,
    reason: 'Owns the bead store Gas City records all durable work in.',
  },
  {
    command: 'tmux',
    versionArgs: ['-V'],
    displayName: 'tmux',
    minimumVersion: null,
    installVersion: null,
    reason:
      'Default session backend and always required. Gas City documents no floor and Factoru has no evidence for one.',
  },
  {
    command: 'git',
    versionArgs: ['--version'],
    displayName: 'Git',
    minimumVersion: null,
    installVersion: null,
    reason: 'Repository access for every rig.',
  },
  {
    command: 'jq',
    versionArgs: ['--version'],
    displayName: 'jq',
    minimumVersion: null,
    installVersion: null,
    reason: 'Used by Gas City pack scripts.',
  },
  {
    command: 'flock',
    versionArgs: ['--version'],
    displayName: 'flock',
    minimumVersion: null,
    installVersion: null,
    reason: 'Bead store locking.',
  },
]

/**
 * Verified release artifacts installed by the unprivileged Linux source bootstrap.
 * Digests are the SHA-256 values published with the corresponding GitHub releases.
 */
export const SOURCE_BOOTSTRAP_ARTIFACTS: Readonly<
  Record<'gc' | 'dolt' | 'bd', SourceBootstrapArtifact>
> = {
  gc: {
    command: 'gc',
    version: PINNED_GAS_CITY_VERSION,
    repository: 'gastownhall/gascity',
    fileNames: {
      amd64: `gascity_${PINNED_GAS_CITY_VERSION}_linux_amd64.tar.gz`,
      arm64: `gascity_${PINNED_GAS_CITY_VERSION}_linux_arm64.tar.gz`,
    },
    sha256: {
      amd64: 'f6bd0bfaf2acc141642227629394dd3279761df4e1800235551af24d98b9cae0',
      arm64: '672eb244613812332a6524a982e0c3455956f1813f4fa9a761e5f6103259a099',
    },
  },
  dolt: {
    command: 'dolt',
    version: PINNED_DOLT_INSTALL_VERSION,
    repository: 'dolthub/dolt',
    fileNames: {
      amd64: 'dolt-linux-amd64.tar.gz',
      arm64: 'dolt-linux-arm64.tar.gz',
    },
    sha256: {
      amd64: '15983e811341ed94e5d47fbfc41d2f57d8c7aa65eee511d25a3c3fd5477e28e7',
      arm64: '3edb3e5d05889f654dca548a8b6eb367551d4418ee0be5a79d94ea1c0f40ae8d',
    },
  },
  bd: {
    command: 'bd',
    version: PINNED_BEADS_INSTALL_VERSION,
    repository: 'gastownhall/beads',
    fileNames: {
      amd64: `beads_${PINNED_BEADS_INSTALL_VERSION}_linux_amd64.tar.gz`,
      arm64: `beads_${PINNED_BEADS_INSTALL_VERSION}_linux_arm64.tar.gz`,
    },
    sha256: {
      amd64: 'a72d71ed374955dc9f83a0f90b54bd7b6a0016709dd1676ae2e368651ed401c2',
      arm64: 'a134015faf4be0a43f8681a8d602eaf0b7c255c957f09d3c933257c8c92fdd10',
    },
  },
}

/** Agent harnesses Factoru supports binding a Worker Type model slot to. */
export const SUPPORTED_HARNESSES = ['claude', 'codex'] as const

export type SupportedHarness = (typeof SUPPORTED_HARNESSES)[number]
