import { describe, expect, it } from 'vitest'
import { FACTORY_NAME_MAX_LENGTH, factoryStatusLabel, normalizeFactoryName } from './factory'

describe('factory presentation', () => {
  it('normalizes bounded friendly names', () => {
    expect(normalizeFactoryName('  Raspberry Pi  ')).toBe('Raspberry Pi')
    expect(() => normalizeFactoryName('   ')).toThrow(/required/)
    expect(() => normalizeFactoryName('x'.repeat(FACTORY_NAME_MAX_LENGTH + 1))).toThrow(
      /characters or fewer/,
    )
  })

  it.each([
    ['connected', 'Connected'],
    ['connecting', 'Connecting'],
    ['offline', 'Offline'],
    ['blocked', 'Blocked'],
    ['pairing_required', 'Pairing required'],
  ] as const)('labels %s profiles as %s', (state, label) => {
    expect(factoryStatusLabel(state)).toBe(label)
  })
})
