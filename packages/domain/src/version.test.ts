import { describe, expect, it } from 'vitest'
import { compareVersions, formatVersion, parseVersion, InvalidVersionError } from './version.js'

describe('semantic versions', () => {
  it('parses a release version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('parses a prerelease version', () => {
    expect(parseVersion('0.1.0-alpha.1')).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: 'alpha.1',
    })
  })

  it.each(['', '1', '1.2', 'v1.2.3', '1.2.3.4', '1.2.x'])('rejects %j', (value) => {
    expect(() => parseVersion(value)).toThrow(InvalidVersionError)
  })

  it('formats what it parsed', () => {
    for (const value of ['1.2.3', '0.0.1-rc.2']) {
      expect(formatVersion(parseVersion(value))).toBe(value)
    }
  })

  it('orders by major, minor, then patch', () => {
    const ordered = ['0.1.0', '0.2.0', '0.2.1', '1.0.0'].map(parseVersion)
    for (let i = 1; i < ordered.length; i += 1) {
      expect(compareVersions(ordered[i - 1]!, ordered[i]!)).toBeLessThan(0)
    }
  })

  it('orders a prerelease before its release', () => {
    expect(compareVersions(parseVersion('1.0.0-rc.1'), parseVersion('1.0.0'))).toBeLessThan(0)
    expect(compareVersions(parseVersion('1.0.0'), parseVersion('1.0.0-rc.1'))).toBeGreaterThan(0)
    expect(compareVersions(parseVersion('1.0.0'), parseVersion('1.0.0'))).toBe(0)
  })
})
