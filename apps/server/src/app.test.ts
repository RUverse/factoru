import { afterEach, describe, expect, it } from 'vitest'
import { createServerId } from '@factoru/domain'
import {
  HANDSHAKE_PATH,
  HEALTH_PATH,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  SERVER_ID_PATTERN,
  handshakeResponseSchema,
  healthResponseSchema,
  problemSchema,
} from '@factoru/protocol'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './app.js'

let app: FastifyInstance | undefined

function startTestServer(overrides: Partial<Parameters<typeof buildServer>[0]> = {}) {
  app = buildServer({
    serverId: createServerId(),
    logLevel: 'silent',
    startedAt: new Date('2026-08-04T12:00:00.000Z'),
    now: () => new Date('2026-08-04T12:00:05.000Z'),
    ...overrides,
  })
  return app
}

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('GET /api/v1/health', () => {
  it('returns a payload the shared protocol schema accepts', async () => {
    const server = startTestServer()
    const response = await server.inject({ method: 'GET', url: HEALTH_PATH })

    expect(response.statusCode).toBe(200)
    const health = healthResponseSchema.parse(response.json())
    expect(health.status).toBe('ok')
    expect(health.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(health.minProtocolVersion).toBe(MIN_SUPPORTED_PROTOCOL_VERSION)
    expect(health.capabilities).toContain('handshake')
    expect(health.uptimeMs).toBe(5_000)
  })

  it('reports the server identity in the wire format the protocol defines', async () => {
    const serverId = createServerId()
    const server = startTestServer({ serverId })
    const health = healthResponseSchema.parse(
      (await server.inject({ method: 'GET', url: HEALTH_PATH })).json(),
    )

    expect(health.serverId).toBe(serverId)
    expect(SERVER_ID_PATTERN.test(health.serverId)).toBe(true)
  })

  it('never reports a negative uptime when the clock moves backwards', async () => {
    const server = startTestServer({
      startedAt: new Date('2026-08-04T12:00:00.000Z'),
      now: () => new Date('2026-08-04T11:59:00.000Z'),
    })
    const health = healthResponseSchema.parse(
      (await server.inject({ method: 'GET', url: HEALTH_PATH })).json(),
    )
    expect(health.uptimeMs).toBe(0)
  })
})

describe('POST /api/v1/handshake', () => {
  const request = {
    clientName: 'factoru-desktop',
    clientVersion: '0.0.0',
    protocolVersion: PROTOCOL_VERSION,
    minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
  }

  it('accepts a matching client and negotiates a version', async () => {
    const server = startTestServer()
    const response = await server.inject({ method: 'POST', url: HANDSHAKE_PATH, payload: request })

    expect(response.statusCode).toBe(200)
    const handshake = handshakeResponseSchema.parse(response.json())
    expect(handshake.compatible).toBe(true)
    expect(handshake.negotiatedProtocolVersion).toBe(PROTOCOL_VERSION)
    expect(handshake.incompatibility).toBeNull()
  })

  it('answers an incompatible client with a verdict rather than an error', async () => {
    const server = startTestServer()
    const response = await server.inject({
      method: 'POST',
      url: HANDSHAKE_PATH,
      payload: {
        ...request,
        protocolVersion: PROTOCOL_VERSION + 5,
        minProtocolVersion: PROTOCOL_VERSION + 5,
      },
    })

    expect(response.statusCode).toBe(200)
    const handshake = handshakeResponseSchema.parse(response.json())
    expect(handshake.compatible).toBe(false)
    expect(handshake.negotiatedProtocolVersion).toBeNull()
    expect(handshake.incompatibility?.code).toBe('server_too_old')
  })

  it.each([
    ['a missing client name', { ...request, clientName: undefined }],
    ['a non-numeric protocol version', { ...request, protocolVersion: 'one' }],
    ['an inverted protocol range', { ...request, protocolVersion: 1, minProtocolVersion: 9 }],
    ['an empty body', {}],
  ])('rejects %s with a structured problem', async (_name, payload) => {
    const server = startTestServer()
    const response = await server.inject({ method: 'POST', url: HANDSHAKE_PATH, payload })

    expect(response.statusCode).toBe(400)
    expect(problemSchema.parse(response.json()).error.code).toBe('invalid_request')
  })

  it('rejects a malformed JSON body without crashing', async () => {
    const server = startTestServer()
    const response = await server.inject({
      method: 'POST',
      url: HANDSHAKE_PATH,
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    })

    expect(response.statusCode).toBe(400)
    expect(problemSchema.parse(response.json()).error.code).toBe('invalid_request')
  })
})

describe('unknown operations', () => {
  it('returns a structured not_found problem', async () => {
    const server = startTestServer()
    const response = await server.inject({ method: 'GET', url: '/api/v1/projects' })

    expect(response.statusCode).toBe(404)
    expect(problemSchema.parse(response.json()).error.code).toBe('not_found')
  })
})
