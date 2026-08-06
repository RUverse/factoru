import { describe, expect, it, vi } from 'vitest'
import {
  FactoruProtocolError,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  checkCompatibility,
  descriptorFromHealth,
  type FactoruClient,
  type HealthResponse,
} from '@factoru/protocol'
import { ConnectionRuntime } from './connection-runtime'
import type { ConnectionSnapshot } from '../shared/connection'
import { isCached } from '../shared/connection'

const health: HealthResponse = {
  status: 'ok',
  serverId: `srv_${'c'.repeat(32)}`,
  serverVersion: '0.0.0',
  protocolVersion: PROTOCOL_VERSION,
  minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
  capabilities: ['health', 'handshake'],
  startedAt: '2026-08-04T12:00:00.000Z',
  uptimeMs: 1_000,
}

interface FakeClientOptions {
  handshake?: FactoruClient['handshake']
  health?: FactoruClient['health']
}

function fakeClient(options: FakeClientOptions = {}): FactoruClient {
  const server = descriptorFromHealth(health)
  return {
    baseUrl: 'http://127.0.0.1:20000',
    pair: vi.fn(async () => {
      throw new Error('pairing is outside connection-runtime tests')
    }),
    createConnectionTicket: vi.fn(async () => {
      throw new Error('ticketing is outside connection-runtime tests')
    }),
    handshake:
      options.handshake ??
      vi.fn(async () => ({
        response: {
          server,
          compatible: true,
          negotiatedProtocolVersion: PROTOCOL_VERSION,
          incompatibility: null,
        },
        compatibility: checkCompatibility(
          { protocolVersion: PROTOCOL_VERSION, minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION },
          server,
        ),
      })),
    health: options.health ?? vi.fn(async () => health),
  }
}

function runtime(client: FactoruClient) {
  return new ConnectionRuntime({
    client,
    now: () => new Date('2026-08-04T12:00:01.000Z'),
    // Never schedule real timers in unit tests.
    setTimer: () => null,
    clearTimer: () => undefined,
  })
}

describe('connection runtime', () => {
  it('starts unconfigured with nothing to display', () => {
    const snapshot = runtime(fakeClient()).snapshot
    expect(snapshot.state).toBe('unconfigured')
    expect(snapshot.health).toBeNull()
    expect(isCached(snapshot)).toBe(false)
  })

  it('connects and exposes the server health it validated', async () => {
    const snapshot = await runtime(fakeClient()).refresh()

    expect(snapshot.state).toBe('connected')
    expect(snapshot.health).toEqual(health)
    expect(snapshot.negotiatedProtocolVersion).toBe(PROTOCOL_VERSION)
    expect(snapshot.error).toBeNull()
    expect(snapshot.lastConnectedAt).toBe('2026-08-04T12:00:01.000Z')
    expect(isCached(snapshot)).toBe(false)
  })

  it('goes offline when the server is unreachable', async () => {
    const client = fakeClient({
      handshake: vi.fn(async () => {
        throw new FactoruProtocolError('transport_error', 'Could not reach Factoru Server')
      }),
    })
    const snapshot = await runtime(client).refresh()

    expect(snapshot.state).toBe('offline')
    expect(snapshot.error).toEqual({
      code: 'transport_error',
      message: 'Could not reach Factoru Server',
    })
    expect(snapshot.health).toBeNull()
  })

  it('blocks on an incompatible server rather than reporting it as offline', async () => {
    const incompatibleServer = {
      ...descriptorFromHealth(health),
      protocolVersion: PROTOCOL_VERSION + 3,
      minProtocolVersion: PROTOCOL_VERSION + 3,
    }
    const client = fakeClient({
      handshake: vi.fn(async () => ({
        response: {
          server: incompatibleServer,
          compatible: false,
          negotiatedProtocolVersion: null,
          incompatibility: { code: 'client_too_old' as const, message: 'Update Factoru Desktop.' },
        },
        compatibility: checkCompatibility(
          { protocolVersion: PROTOCOL_VERSION, minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION },
          incompatibleServer,
        ),
      })),
    })

    const snapshot = await runtime(client).refresh()

    expect(snapshot.state).toBe('blocked')
    expect(snapshot.blockedReason).toBe('incompatible_protocol')
    expect(snapshot.error?.code).toBe('unsupported_protocol_version')
    expect(client.health).not.toHaveBeenCalled()
  })

  it('blocks when the server answers with something the protocol rejects', async () => {
    const client = fakeClient({
      health: vi.fn(async () => {
        throw new FactoruProtocolError('invalid_response', 'invalid health response')
      }),
    })
    const snapshot = await runtime(client).refresh()

    expect(snapshot.state).toBe('blocked')
    expect(snapshot.blockedReason).toBe('invalid_response')
  })

  it('recovers from offline back to connected and keeps cached health meanwhile', async () => {
    const handshake = vi
      .fn<FactoruClient['handshake']>()
      .mockImplementationOnce(fakeClient().handshake)
      .mockImplementationOnce(async () => {
        throw new FactoruProtocolError('timeout', 'no response')
      })
      .mockImplementation(fakeClient().handshake)

    const connection = runtime(fakeClient({ handshake }))

    expect((await connection.refresh()).state).toBe('connected')

    const offline = await connection.refresh()
    expect(offline.state).toBe('offline')
    expect(offline.health).toEqual(health)
    expect(isCached(offline)).toBe(true)

    expect((await connection.refresh()).state).toBe('connected')
  })

  it('notifies subscribers about state changes and stops after unsubscribe', async () => {
    const connection = runtime(fakeClient())
    const seen: ConnectionSnapshot[] = []
    const unsubscribe = connection.subscribe((snapshot) => seen.push(snapshot))

    await connection.refresh()
    expect(seen.at(-1)?.state).toBe('connected')

    unsubscribe()
    const before = seen.length
    await connection.refresh()
    expect(seen.length).toBe(before)
  })

  it('shares one in-flight attempt between concurrent callers', async () => {
    const client = fakeClient()
    const connection = runtime(client)

    await Promise.all([connection.refresh(), connection.refresh(), connection.refresh()])

    expect(client.handshake).toHaveBeenCalledTimes(1)
  })

  it('schedules the next check only while running', async () => {
    const setTimer = vi.fn(() => 1)
    const client = fakeClient()
    const connection = new ConnectionRuntime({ client, setTimer, clearTimer: vi.fn() })

    await connection.refresh()
    expect(setTimer).not.toHaveBeenCalled()

    connection.start()
    await connection.refresh()
    expect(setTimer).toHaveBeenCalled()

    connection.stop()
    setTimer.mockClear()
    await connection.refresh()
    expect(setTimer).not.toHaveBeenCalled()
  })

  it('keeps retrying while offline', async () => {
    const setTimer = vi.fn(() => 1)
    const client = fakeClient({
      handshake: vi.fn(async () => {
        throw new FactoruProtocolError('transport_error', 'unreachable')
      }),
    })
    const connection = new ConnectionRuntime({ client, setTimer, clearTimer: vi.fn() })

    connection.start()
    await connection.refresh()

    expect(connection.snapshot.state).toBe('offline')
    expect(setTimer).toHaveBeenCalled()
  })

  it('stops polling once blocked, because retrying cannot resolve it', async () => {
    const setTimer = vi.fn(() => 1)
    const client = fakeClient({
      health: vi.fn(async () => {
        throw new FactoruProtocolError('unauthorized', 'device credential revoked')
      }),
    })
    const connection = new ConnectionRuntime({ client, setTimer, clearTimer: vi.fn() })

    connection.start()
    await connection.refresh()
    expect(connection.snapshot.state).toBe('blocked')

    setTimer.mockClear()
    await connection.refresh()

    expect(connection.snapshot.state).toBe('blocked')
    expect(setTimer).not.toHaveBeenCalled()
  })

  it('leaves blocked when an explicit refresh succeeds after the problem is fixed', async () => {
    const healthy = fakeClient().health
    const health = vi
      .fn<FactoruClient['health']>()
      .mockImplementationOnce(async () => {
        throw new FactoruProtocolError('unauthorized', 'device credential revoked')
      })
      .mockImplementation(healthy)

    const connection = runtime(fakeClient({ health }))

    expect((await connection.refresh()).state).toBe('blocked')
    expect((await connection.refresh()).state).toBe('connected')
  })

  it('treats an unexpected thrown value as a transport failure', async () => {
    const client = fakeClient({
      handshake: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const snapshot = await runtime(client).refresh()

    expect(snapshot.state).toBe('offline')
    expect(snapshot.error?.code).toBe('transport_error')
  })
})
