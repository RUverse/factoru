import { describe, expect, it } from 'vitest'
import {
  deviceRevokeParamsSchema,
  liveRequestSchema,
  pairingExchangeRequestSchema,
  projectSnapshotSchema,
} from './milestone2.js'

describe('Milestone 2 protocol', () => {
  it('accepts a formatted pairing code and rejects ambiguous characters', () => {
    expect(
      pairingExchangeRequestSchema.safeParse({ code: 'ABCD-EFGH-JKMN', deviceName: 'Mac' }).success,
    ).toBe(true)
    expect(
      pairingExchangeRequestSchema.safeParse({ code: 'ABCI-EFGH-JKMN', deviceName: 'Mac' }).success,
    ).toBe(false)
  })

  it('requires self-revocation confirmation to be explicit', () => {
    expect(deviceRevokeParamsSchema.parse({ deviceId: 'dev_one' }).confirmSelf).toBe(false)
    expect(
      deviceRevokeParamsSchema.parse({ deviceId: 'dev_one', confirmSelf: true }).confirmSelf,
    ).toBe(true)
  })

  it('requires command identifiers separately from query payloads', () => {
    expect(
      liveRequestSchema.parse({
        id: '1',
        method: 'projects.create',
        params: {},
        commandId: 'cmd_1',
      }).commandId,
    ).toBe('cmd_1')
  })

  it('validates an empty cursor snapshot', () => {
    expect(
      projectSnapshotSchema.parse({ projects: [], cursor: 0, resynchronized: false, events: [] }),
    ).toEqual({
      projects: [],
      cursor: 0,
      resynchronized: false,
      events: [],
    })
  })
})
