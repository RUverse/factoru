import { describe, expect, it } from 'vitest'
import {
  FACTORY_NAME_MAX_LENGTH,
  factoryAggregateStatus,
  factoryStatusLabel,
  normalizeFactoryName,
} from './factory'

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

  it('summarizes aggregate factory health without implying one active factory', () => {
    expect(factoryAggregateStatus([{ connectionState: 'connected' }])).toEqual({
      label: '1 factory online',
      state: 'connected',
    })
    expect(
      factoryAggregateStatus([
        { connectionState: 'connected' },
        { connectionState: 'connected' },
        { connectionState: 'offline' },
      ]),
    ).toEqual({ label: '2 factories online', state: 'connected' })
    expect(factoryAggregateStatus([{ connectionState: 'connecting' }])).toEqual({
      label: 'Connecting to factories…',
      state: 'connecting',
    })
    expect(factoryAggregateStatus([{ connectionState: 'blocked' }])).toEqual({
      label: 'No factories online',
      state: 'offline',
    })
  })
})
