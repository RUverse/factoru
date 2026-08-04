import { describe, expect, it, vi } from 'vitest'
import { createFactoruClient, type FetchLike } from './client.js'
import { FactoruProtocolError, problem } from './errors.js'
import { descriptorFromHealth, type HealthResponse } from './schemas.js'
import {
  HANDSHAKE_PATH,
  HEALTH_PATH,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from './version.js'

const health: HealthResponse = {
  status: 'ok',
  serverId: `srv_${'b'.repeat(32)}`,
  serverVersion: '0.0.0',
  protocolVersion: PROTOCOL_VERSION,
  minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
  capabilities: ['health', 'handshake'],
  startedAt: '2026-08-04T12:00:00.000Z',
  uptimeMs: 10,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function client(fetchImpl: FetchLike, baseUrl = 'http://127.0.0.1:41234') {
  return createFactoruClient({
    baseUrl,
    clientName: 'test-client',
    clientVersion: '0.0.0',
    fetch: fetchImpl,
    timeoutMs: 1_000,
  })
}

describe('factoru client', () => {
  it('requests health from the versioned path and validates the payload', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(health))
    const result = await client(fetchImpl).health()

    expect(result).toEqual(health)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]![0]).toBe(`http://127.0.0.1:41234${HEALTH_PATH}`)
  })

  it('normalizes a base URL with a trailing slash', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(health))
    await client(fetchImpl, 'http://127.0.0.1:41234/').health()
    expect(fetchImpl.mock.calls[0]![0]).toBe(`http://127.0.0.1:41234${HEALTH_PATH}`)
  })

  it.each(['not-a-url', 'ftp://example.com', 'file:///tmp'])(
    'rejects the base URL %j',
    (baseUrl) => {
      expect(() =>
        createFactoruClient({ baseUrl, clientName: 'c', clientVersion: '0.0.0', fetch: vi.fn() }),
      ).toThrow(FactoruProtocolError)
    },
  )

  it('rejects a structurally invalid health payload', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ ...health, serverId: 'bogus' }))
    await expect(client(fetchImpl).health()).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('rejects a non-JSON response', async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () => new Response('<html>nope</html>', { status: 200 }),
    )
    await expect(client(fetchImpl).health()).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('maps a structured server problem onto its code', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse(problem('invalid_request', 'clientName is required'), 400),
    )
    await expect(client(fetchImpl).handshake()).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
      message: 'clientName is required',
    })
  })

  it('maps an unstructured error response onto invalid_response', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ oops: true }, 503))
    await expect(client(fetchImpl).health()).rejects.toMatchObject({
      code: 'invalid_response',
      status: 503,
    })
  })

  it('reports an unreachable server as a retryable transport error', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed')
    })
    const error = await client(fetchImpl)
      .health()
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FactoruProtocolError)
    expect((error as FactoruProtocolError).code).toBe('transport_error')
    expect((error as FactoruProtocolError).retryable).toBe(true)
  })

  it('sends its own protocol range on handshake', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        server: descriptorFromHealth(health),
        compatible: true,
        negotiatedProtocolVersion: PROTOCOL_VERSION,
        incompatibility: null,
      }),
    )

    const outcome = await client(fetchImpl).handshake()

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`http://127.0.0.1:41234${HANDSHAKE_PATH}`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      clientName: 'test-client',
      clientVersion: '0.0.0',
      protocolVersion: PROTOCOL_VERSION,
      minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
    })
    expect(outcome.compatibility.compatible).toBe(true)
  })

  it('does not trust the server verdict when the ranges do not overlap', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        server: {
          ...descriptorFromHealth(health),
          protocolVersion: PROTOCOL_VERSION + 10,
          minProtocolVersion: PROTOCOL_VERSION + 10,
        },
        // A server that wrongly claims compatibility must not be believed.
        compatible: true,
        negotiatedProtocolVersion: PROTOCOL_VERSION,
        incompatibility: null,
      }),
    )

    const outcome = await client(fetchImpl).handshake()

    expect(outcome.response.compatible).toBe(true)
    expect(outcome.compatibility.compatible).toBe(false)
    expect(outcome.compatibility.incompatibility?.code).toBe('client_too_old')
  })
})
