import { describe, expect, it } from 'vitest'
import {
  createServerId,
  isServerId,
  parseServerId,
  InvalidServerIdError,
} from './server-identity.js'

describe('server identity', () => {
  it('creates ids that round trip through parsing', () => {
    const id = createServerId()
    expect(isServerId(id)).toBe(true)
    expect(parseServerId(id)).toBe(id)
  })

  it('creates distinct ids', () => {
    expect(createServerId()).not.toBe(createServerId())
  })

  it.each([
    ['empty', ''],
    ['missing prefix', '0123456789abcdef0123456789abcdef'],
    ['wrong prefix', `svr_${'a'.repeat(32)}`],
    ['too short', `srv_${'a'.repeat(31)}`],
    ['uppercase hex', `srv_${'A'.repeat(32)}`],
    ['trailing content', `srv_${'a'.repeat(32)}x`],
  ])('rejects an id with %s', (_name, value) => {
    expect(isServerId(value)).toBe(false)
    expect(() => parseServerId(value)).toThrow(InvalidServerIdError)
  })

  it('rejects non-string values', () => {
    expect(isServerId(undefined)).toBe(false)
    expect(isServerId(42)).toBe(false)
    expect(isServerId({})).toBe(false)
  })
})
