/**
 * A minimal semantic version value object.
 *
 * Desktop/server compatibility is negotiated through the protocol version, not
 * through identical application versions, so this type only needs to parse,
 * compare, and format application versions for display and diagnostics.
 */
export interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease?: string
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export class InvalidVersionError extends Error {
  constructor(readonly value: string) {
    super(`Invalid semantic version: ${JSON.stringify(value)}`)
    this.name = 'InvalidVersionError'
  }
}

export function parseVersion(value: string): SemanticVersion {
  const match = VERSION_PATTERN.exec(value)
  if (!match) {
    throw new InvalidVersionError(value)
  }
  const [, major, minor, patch, prerelease] = match
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    ...(prerelease === undefined ? {} : { prerelease }),
  }
}

export function formatVersion(version: SemanticVersion): string {
  const core = `${version.major}.${version.minor}.${version.patch}`
  return version.prerelease === undefined ? core : `${core}-${version.prerelease}`
}

/** Returns a negative number when `a` precedes `b`, following semver ordering. */
export function compareVersions(a: SemanticVersion, b: SemanticVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease === b.prerelease) return 0
  // A release always precedes nothing and follows any prerelease of the same core.
  if (a.prerelease === undefined) return 1
  if (b.prerelease === undefined) return -1
  return a.prerelease < b.prerelease ? -1 : 1
}
