import { describe, expect, it } from 'vitest'
import { checkCompatibility, LOCAL_PROTOCOL_RANGE } from './compatibility.js'
import { MIN_SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION } from './version.js'

describe('protocol compatibility', () => {
  it('is self-compatible', () => {
    const result = checkCompatibility(LOCAL_PROTOCOL_RANGE, LOCAL_PROTOCOL_RANGE)
    expect(result.compatible).toBe(true)
    expect(result.negotiatedProtocolVersion).toBe(PROTOCOL_VERSION)
  })

  it('declares a sane local range', () => {
    expect(MIN_SUPPORTED_PROTOCOL_VERSION).toBeLessThanOrEqual(PROTOCOL_VERSION)
  })

  it('negotiates the highest version both peers speak', () => {
    const result = checkCompatibility(
      { protocolVersion: 5, minProtocolVersion: 2 },
      { protocolVersion: 3, minProtocolVersion: 1 },
    )
    expect(result).toEqual({
      compatible: true,
      negotiatedProtocolVersion: 3,
      incompatibility: null,
    })
  })

  it('reports a server that is too old', () => {
    const result = checkCompatibility(
      { protocolVersion: 5, minProtocolVersion: 4 },
      { protocolVersion: 3, minProtocolVersion: 1 },
    )
    expect(result.compatible).toBe(false)
    expect(result.incompatibility?.code).toBe('server_too_old')
    expect(result.incompatibility?.message).toContain('Update Factoru Server')
  })

  it('reports a client that is too old', () => {
    const result = checkCompatibility(
      { protocolVersion: 2, minProtocolVersion: 1 },
      { protocolVersion: 7, minProtocolVersion: 5 },
    )
    expect(result.compatible).toBe(false)
    expect(result.incompatibility?.code).toBe('client_too_old')
    expect(result.incompatibility?.message).toContain('Update Factoru Desktop')
  })

  it('is symmetric about whether an overlap exists', () => {
    const ranges = [
      { protocolVersion: 1, minProtocolVersion: 1 },
      { protocolVersion: 3, minProtocolVersion: 1 },
      { protocolVersion: 4, minProtocolVersion: 3 },
      { protocolVersion: 9, minProtocolVersion: 8 },
    ]
    for (const a of ranges) {
      for (const b of ranges) {
        expect(checkCompatibility(a, b).compatible).toBe(checkCompatibility(b, a).compatible)
      }
    }
  })
})
