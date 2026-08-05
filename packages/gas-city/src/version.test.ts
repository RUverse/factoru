import { describe, expect, it } from 'vitest'

import { compareVersions, parseVersion, satisfiesMinimum, withinRange } from './version.js'

describe('parseVersion', () => {
  // These are the exact strings the real executables printed during the
  // Milestone 1 gate. If a future release changes its format, this is where it
  // should be caught.
  it.each([
    ['1.4.0', { major: 1, minor: 4, patch: 0, suffix: '' }],
    ['bd version 1.1.2 (Homebrew)', { major: 1, minor: 1, patch: 2, suffix: '' }],
    ['dolt version 2.2.3', { major: 2, minor: 2, patch: 3, suffix: '' }],
    ['tmux 3.7b', { major: 3, minor: 7, patch: 0, suffix: 'b' }],
    ['flock 0.4.0', { major: 0, minor: 4, patch: 0, suffix: '' }],
    ['git version 2.51.0', { major: 2, minor: 51, patch: 0, suffix: '' }],
  ])('parses %j', (input, expected) => {
    expect(parseVersion(input)).toEqual(expected)
  })

  it('returns null when there is no version-shaped token', () => {
    expect(parseVersion('command not found')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('compareVersions', () => {
  const v = (s: string) => parseVersion(s)!

  it('orders by major, then minor, then patch', () => {
    expect(compareVersions(v('2.0.0'), v('1.9.9'))).toBeGreaterThan(0)
    expect(compareVersions(v('1.4.0'), v('1.5.0'))).toBeLessThan(0)
    expect(compareVersions(v('1.4.1'), v('1.4.0'))).toBeGreaterThan(0)
    expect(compareVersions(v('1.4.0'), v('1.4.0'))).toBe(0)
  })

  it('sorts a suffixed build before the plain release', () => {
    // 1.0.0-rc1 is a pre-release of 1.0.0, not a successor to it.
    expect(compareVersions(v('1.0.0-rc1'), v('1.0.0'))).toBeLessThan(0)
    expect(compareVersions(v('3.7a'), v('3.7b'))).toBeLessThan(0)
  })
})

describe('satisfiesMinimum', () => {
  it('accepts equal and newer versions', () => {
    expect(satisfiesMinimum('dolt version 2.1.0', '2.1.0')).toBe(true)
    expect(satisfiesMinimum('dolt version 2.2.3', '2.1.0')).toBe(true)
  })

  it('rejects a build below the floor', () => {
    // The Dolt floor exists because older builds can hang under write load
    // rather than refusing to start, so this must not be lenient.
    expect(satisfiesMinimum('dolt version 2.0.9', '2.1.0')).toBe(false)
  })

  it('rejects a version it cannot parse rather than assuming it is new enough', () => {
    expect(satisfiesMinimum('dolt: command not found', '2.1.0')).toBe(false)
  })
})

describe('withinRange', () => {
  const range = { minimum: '1.4.0', belowExclusive: '1.5.0' } as const

  it('accepts patch movement inside the pinned minor', () => {
    expect(withinRange('1.4.0', range)).toBe(true)
    expect(withinRange('1.4.7', range)).toBe(true)
  })

  it('rejects a version below the pin or at the next minor', () => {
    expect(withinRange('1.3.9', range)).toBe(false)
    // A minor bump re-opens the feasibility gate; it is not silently accepted.
    expect(withinRange('1.5.0', range)).toBe(false)
    expect(withinRange('2.0.0', range)).toBe(false)
  })
})
