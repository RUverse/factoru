import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LiveMethod, PairingExchangeResponse } from '@factoru/protocol'
import { CredentialStore, ProfileStore, type ServerProfile } from './profile-store'
import {
  ProductRuntime,
  type ProductLiveClient,
  type ProductRuntimeOptions,
} from './product-runtime'

const directories: string[] = []

function directory(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-product-runtime-'))
  directories.push(value)
  return value
}

function profile(serverId: string, url: string, name: string): ServerProfile {
  return {
    serverId,
    deviceId: `dev_${name.toLowerCase()}`,
    kind: 'remote',
    name,
    url,
    createdAt: '2026-08-11T12:00:00.000Z',
    lastConnectedAt: null,
    projects: [],
    selectedProjectId: null,
    workspaces: {},
    cursor: 0,
  }
}

function pairingResponse(serverId: string): PairingExchangeResponse {
  return {
    serverId,
    device: {
      id: 'dev_desktop',
      name: 'My Mac',
      scopes: ['projects:read', 'projects:write', 'events:read', 'devices:read', 'devices:revoke'],
      createdAt: '2026-08-11T12:00:00.000Z',
      lastSeenAt: null,
      revokedAt: null,
    },
    token: 't'.repeat(32),
  }
}

class FakeLiveClient implements ProductLiveClient {
  connectCount = 0
  closeCount = 0
  readonly requests: LiveMethod[] = []
  #closeListener: (() => void) | null = null

  constructor(readonly url: string) {}

  async connect(): Promise<void> {
    this.connectCount += 1
  }

  close(): void {
    this.closeCount += 1
  }

  onEvent(): void {}

  onClose(listener: () => void): void {
    this.#closeListener = listener
  }

  disconnect(): void {
    this.#closeListener?.()
  }

  async request(method: LiveMethod): Promise<unknown> {
    this.requests.push(method)
    if (method === 'projects.subscribe') {
      return { cursor: 0, projects: [], resynchronized: false, events: [] }
    }
    return { url: this.url }
  }
}

afterEach(() => {
  for (const value of directories.splice(0)) fs.rmSync(value, { recursive: true })
})

describe('multi-server product runtime', () => {
  it('keeps every saved server connected while activation only changes command routing', async () => {
    const root = directory()
    const profiles = new ProfileStore(root)
    const first = profile(`srv_${'a'.repeat(32)}`, 'http://127.0.0.1:18787', 'Local')
    const second = profile(`srv_${'b'.repeat(32)}`, 'http://127.0.0.1:18788', 'Pi')
    profiles.save(first)
    profiles.save(second)

    const credentials = new CredentialStore(root, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    })
    credentials.set(first.serverId, 'first-token')
    credentials.set(second.serverId, 'second-token')

    const serverIds = new Map([
      [first.url, first.serverId],
      [second.url, second.serverId],
    ])
    const liveClients = new Map<string, FakeLiveClient>()
    const createClient: NonNullable<ProductRuntimeOptions['createClient']> = (options) => ({
      baseUrl: options.baseUrl,
      handshake: async () => ({
        response: {
          server: {
            serverId: serverIds.get(options.baseUrl)!,
            serverVersion: '0.0.0',
            protocolVersion: 1,
            minProtocolVersion: 1,
            capabilities: [],
          },
          compatible: true,
          negotiatedProtocolVersion: 1,
          incompatibility: null,
        },
        compatibility: {
          compatible: true,
          negotiatedProtocolVersion: 1,
          incompatibility: null,
        },
      }),
      pair: async () => {
        throw new Error('pair is not used by this test')
      },
      pairLocal: async () => {
        throw new Error('local pairing is not used by this test')
      },
    })

    const runtime = new ProductRuntime(profiles, credentials, {
      createClient,
      createLiveClient: (options) => {
        const live = new FakeLiveClient(options.baseUrl)
        liveClients.set(options.baseUrl, live)
        return live
      },
      now: () => new Date('2026-08-11T12:30:00.000Z'),
    })

    await runtime.connectAll()

    expect(runtime.snapshot.profiles).toEqual([
      expect.objectContaining({ serverId: first.serverId, connectionState: 'connected' }),
      expect.objectContaining({ serverId: second.serverId, connectionState: 'connected' }),
    ])
    expect(liveClients.get(first.url)?.connectCount).toBe(1)
    expect(liveClients.get(second.url)?.connectCount).toBe(1)

    runtime.rename(first.serverId, '  Local Factory  ')
    expect(runtime.snapshot.profiles).toEqual([
      expect.objectContaining({ serverId: first.serverId, name: 'Local Factory' }),
      expect.objectContaining({ serverId: second.serverId, name: 'Pi' }),
    ])
    expect(runtime.snapshot.activeServerId).toBe(second.serverId)

    const originalFirstLive = liveClients.get(first.url)!
    const secondLive = liveClients.get(second.url)!
    await runtime.connect(first.serverId)
    expect(originalFirstLive.closeCount).toBe(1)
    expect(liveClients.get(first.url)).not.toBe(originalFirstLive)
    expect(secondLive.closeCount).toBe(0)
    expect(runtime.snapshot.activeServerId).toBe(second.serverId)

    await runtime.activate(first.serverId)
    const result = await runtime.request('devices.list')

    expect(result).toEqual({ url: first.url })
    expect(liveClients.get(first.url)?.closeCount).toBe(0)
    expect(liveClients.get(second.url)?.closeCount).toBe(0)

    liveClients.get(first.url)?.disconnect()

    expect(runtime.snapshot.profiles).toEqual([
      expect.objectContaining({ serverId: first.serverId, connectionState: 'offline' }),
      expect.objectContaining({ serverId: second.serverId, connectionState: 'connected' }),
    ])
    expect(runtime.snapshot.connected).toBe(false)

    await runtime.activate(second.serverId)

    expect(runtime.snapshot.connected).toBe(true)

    runtime.remove(first.serverId)

    expect(liveClients.get(first.url)?.closeCount).toBe(0)
    expect(liveClients.get(second.url)?.closeCount).toBe(0)
    expect(runtime.snapshot.activeServerId).toBe(second.serverId)
    expect(runtime.snapshot.connected).toBe(true)
    runtime.dispose()
  })

  it('persists a friendly name supplied while pairing a remote factory', async () => {
    const root = directory()
    const profiles = new ProfileStore(root)
    const credentials = new CredentialStore(root, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    })
    const serverId = `srv_${'c'.repeat(32)}`
    const runtime = new ProductRuntime(profiles, credentials, {
      createClient: () => ({
        baseUrl: 'http://127.0.0.1:28788',
        handshake: async () => ({
          response: {
            server: {
              serverId,
              serverVersion: '0.0.0',
              protocolVersion: 1,
              minProtocolVersion: 1,
              capabilities: [],
            },
            compatible: true,
            negotiatedProtocolVersion: 1,
            incompatibility: null,
          },
          compatibility: {
            compatible: true,
            negotiatedProtocolVersion: 1,
            incompatibility: null,
          },
        }),
        pair: async () => pairingResponse(serverId),
        pairLocal: async () => {
          throw new Error('pairLocal is not used by this test')
        },
      }),
      createLiveClient: (options) => new FakeLiveClient(options.baseUrl),
      now: () => new Date('2026-08-11T12:30:00.000Z'),
    })

    await runtime.pair('http://127.0.0.1:28788', 'ABCD-EFGH-JKMN', 'My Mac', '  Raspberry Pi  ')

    expect(runtime.snapshot.profiles).toEqual([
      expect.objectContaining({ serverId, kind: 'remote', name: 'Raspberry Pi' }),
    ])
    expect(new ProfileStore(root).active()?.name).toBe('Raspberry Pi')
    runtime.dispose()
  })

  it('reconciles a legacy local profile by enrollment identity before connecting', async () => {
    const root = directory()
    const enrollmentFile = path.join(root, 'local-enrollment.json')
    const serverId = `srv_${'e'.repeat(32)}`
    fs.writeFileSync(
      enrollmentFile,
      JSON.stringify({
        version: 1,
        serverId,
        serverUrl: 'http://127.0.0.1:38304',
        proof: 'a'.repeat(43),
      }),
      { mode: 0o600 },
    )
    const profiles = new ProfileStore(root)
    profiles.save(profile(serverId, 'http://127.0.0.1:38300', '127.0.0.1'))
    const credentials = new CredentialStore(root, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    })
    credentials.set(serverId, 'local-token')
    const runtime = new ProductRuntime(profiles, credentials, {
      localEnrollmentFile: enrollmentFile,
      createClient: (options) => ({
        baseUrl: options.baseUrl,
        handshake: async () => ({
          response: {
            server: {
              serverId,
              serverVersion: '0.0.0',
              protocolVersion: 1,
              minProtocolVersion: 1,
              capabilities: [],
            },
            compatible: true,
            negotiatedProtocolVersion: 1,
            incompatibility: null,
          },
          compatibility: {
            compatible: true,
            negotiatedProtocolVersion: 1,
            incompatibility: null,
          },
        }),
        pair: async () => {
          throw new Error('pair is not used by this test')
        },
        pairLocal: async () => {
          throw new Error('pairLocal is not used by this test')
        },
      }),
      createLiveClient: (options) => new FakeLiveClient(options.baseUrl),
    })

    await runtime.connectAll()

    expect(runtime.snapshot.profiles).toEqual([
      expect.objectContaining({
        serverId,
        kind: 'local',
        name: 'Local Factory',
        url: 'http://127.0.0.1:38304',
        connectionState: 'connected',
      }),
    ])
    expect(new ProfileStore(root).active()).toEqual(
      expect.objectContaining({ kind: 'local', name: 'Local Factory' }),
    )
    runtime.dispose()
  })

  it('names a newly enrolled local profile Local Factory', async () => {
    const root = directory()
    const enrollmentFile = path.join(root, 'local-enrollment.json')
    const serverId = `srv_${'d'.repeat(32)}`
    fs.writeFileSync(
      enrollmentFile,
      JSON.stringify({
        version: 1,
        serverId,
        serverUrl: 'http://127.0.0.1:32800',
        proof: 'a'.repeat(43),
      }),
      { mode: 0o600 },
    )
    const profiles = new ProfileStore(root)
    const credentials = new CredentialStore(root, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    })
    const runtime = new ProductRuntime(profiles, credentials, {
      localEnrollmentFile: enrollmentFile,
      createClient: () => ({
        baseUrl: 'http://127.0.0.1:32800',
        handshake: async () => ({
          response: {
            server: {
              serverId,
              serverVersion: '0.0.0',
              protocolVersion: 1,
              minProtocolVersion: 1,
              capabilities: ['local-enrollment-v1'],
            },
            compatible: true,
            negotiatedProtocolVersion: 1,
            incompatibility: null,
          },
          compatibility: {
            compatible: true,
            negotiatedProtocolVersion: 1,
            incompatibility: null,
          },
        }),
        pair: async () => {
          throw new Error('pair is not used by this test')
        },
        pairLocal: async () => pairingResponse(serverId),
      }),
      createLiveClient: (options) => new FakeLiveClient(options.baseUrl),
      now: () => new Date('2026-08-11T12:30:00.000Z'),
    })

    await runtime.pairLocal('My Mac')

    expect(runtime.snapshot.profiles).toEqual([
      expect.objectContaining({ serverId, kind: 'local', name: 'Local Factory' }),
    ])
    expect(() => runtime.remove(serverId)).toThrow(/cannot be forgotten/)
    runtime.dispose()
  })
})
