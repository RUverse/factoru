/**
 * Version parsing and comparison for Gas City's dependency chain.
 *
 * Every executable in that chain prints its version differently — `1.4.0`,
 * `bd version 1.1.2 (Homebrew)`, `dolt version 2.2.3`, `tmux 3.7b`, `jq-1.7.1`.
 * Factoru reads all of them, so parsing is deliberately tolerant about the
 * surrounding text and strict about the number it extracts.
 */

export interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** Any trailing text, such as the `b` in tmux's `3.7b`. Compared last. */
  readonly suffix: string
}

const VERSION_PATTERN = /(\d+)(?:\.(\d+))?(?:\.(\d+))?([A-Za-z0-9.\-+]*)/

/**
 * Extract the first version-shaped token from arbitrary `--version` output.
 *
 * Returns `null` rather than throwing: an unparsable version is a readiness
 * finding to report, not a crash. It is also not treated as "new enough" —
 * callers must decide, and {@link satisfiesMinimum} refuses an unknown version.
 */
export function parseVersion(output: string): ParsedVersion | null {
  // Skip a leading token that is only a name (`bd version 1.1.2`) by searching
  // the whole string; the first digit run that looks like a version wins.
  const match = VERSION_PATTERN.exec(output)
  if (!match) return null

  const major = Number(match[1])
  if (!Number.isSafeInteger(major)) return null

  return {
    major,
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    suffix: match[4] ?? '',
  }
}

/** Compare two versions. Negative when `a` precedes `b`. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch

  // A release with no suffix sorts after one with a suffix, so `1.0.0` is newer
  // than `1.0.0-rc1`. Two suffixes compare lexically, which is enough for the
  // only real case here (tmux's `3.7a` versus `3.7b`).
  if (a.suffix === b.suffix) return 0
  if (a.suffix === '') return 1
  if (b.suffix === '') return -1
  return a.suffix < b.suffix ? -1 : 1
}

/**
 * Whether `actual` output satisfies a minimum version.
 *
 * An unparsable `actual` fails. Factoru would rather report that it cannot
 * determine a version than let an unknown build through a floor that exists
 * because the older build corrupts or hangs.
 */
export function satisfiesMinimum(actual: string, minimum: string): boolean {
  const parsedActual = parseVersion(actual)
  const parsedMinimum = parseVersion(minimum)
  if (!parsedActual || !parsedMinimum) return false
  return compareVersions(parsedActual, parsedMinimum) >= 0
}

/** Whether `actual` falls in `[minimum, belowExclusive)`. */
export function withinRange(
  actual: string,
  range: { readonly minimum: string; readonly belowExclusive: string },
): boolean {
  const parsedActual = parseVersion(actual)
  const parsedBelow = parseVersion(range.belowExclusive)
  if (!parsedActual || !parsedBelow) return false
  if (!satisfiesMinimum(actual, range.minimum)) return false
  return compareVersions(parsedActual, parsedBelow) < 0
}
