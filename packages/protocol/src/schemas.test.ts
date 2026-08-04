import { describe, expect, it } from 'vitest'
import {
  descriptorFromHealth,
  handshakeRequestSchema,
  handshakeResponseSchema,
  healthResponseSchema,
  serverDescriptorSchema,
  type HealthResponse,
} from './schemas.js'
import { MIN_SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION } from './version.js'

const health: HealthResponse = {
  status: 'ok',
  serverId: `srv_${'a'.repeat(32)}`,
  serverVersion: '0.0.0',
  protocolVersion: PROTOCOL_VERSION,
  minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
  capabilities: ['health', 'handshake'],
  startedAt: '2026-08-04T12:00:00.000Z',
  uptimeMs: 1234,
}

describe('health response schema', () => {
  it('accepts a well-formed response', () => {
    expect(healthResponseSchema.parse(health)).toEqual(health)
  })

  it('rejects a malformed server id', () => {
    expect(healthResponseSchema.safeParse({ ...health, serverId: 'nope' }).success).toBe(false)
  })

  it('rejects a non-ISO start time', () => {
    expect(healthResponseSchema.safeParse({ ...health, startedAt: 'yesterday' }).success).toBe(
      false,
    )
  })

  it('rejects a negative uptime', () => {
    expect(healthResponseSchema.safeParse({ ...health, uptimeMs: -1 }).success).toBe(false)
  })

  it('rejects an inverted protocol range', () => {
    const parsed = healthResponseSchema.safeParse({
      ...health,
      protocolVersion: 1,
      minProtocolVersion: 2,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown status', () => {
    expect(healthResponseSchema.safeParse({ ...health, status: 'fine' }).success).toBe(false)
  })

  it('projects a descriptor that validates on its own', () => {
    expect(serverDescriptorSchema.parse(descriptorFromHealth(health))).toEqual({
      serverId: health.serverId,
      serverVersion: health.serverVersion,
      protocolVersion: health.protocolVersion,
      minProtocolVersion: health.minProtocolVersion,
      capabilities: health.capabilities,
    })
  })
})

describe('handshake schemas', () => {
  const request = {
    clientName: 'factoru-desktop',
    clientVersion: '0.0.0',
    protocolVersion: PROTOCOL_VERSION,
    minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
  }

  it('accepts a well-formed request', () => {
    expect(handshakeRequestSchema.parse(request)).toEqual(request)
  })

  it.each([
    ['a missing client name', { ...request, clientName: undefined }],
    ['an empty client name', { ...request, clientName: '' }],
    ['a fractional protocol version', { ...request, protocolVersion: 1.5 }],
    ['a zero protocol version', { ...request, protocolVersion: 0 }],
    ['a string protocol version', { ...request, protocolVersion: '1' }],
    ['an inverted range', { ...request, protocolVersion: 1, minProtocolVersion: 3 }],
  ])('rejects %s', (_name, value) => {
    expect(handshakeRequestSchema.safeParse(value).success).toBe(false)
  })

  it('accepts a compatible response', () => {
    const response = {
      server: descriptorFromHealth(health),
      compatible: true,
      negotiatedProtocolVersion: PROTOCOL_VERSION,
      incompatibility: null,
    }
    expect(handshakeResponseSchema.parse(response)).toEqual(response)
  })

  it('accepts an incompatible response', () => {
    const response = {
      server: descriptorFromHealth(health),
      compatible: false,
      negotiatedProtocolVersion: null,
      incompatibility: { code: 'client_too_old' as const, message: 'Update Factoru Desktop.' },
    }
    expect(handshakeResponseSchema.parse(response)).toEqual(response)
  })

  it('requires the incompatibility field to be present', () => {
    const response = {
      server: descriptorFromHealth(health),
      compatible: true,
      negotiatedProtocolVersion: PROTOCOL_VERSION,
    }
    expect(handshakeResponseSchema.safeParse(response).success).toBe(false)
  })
})
