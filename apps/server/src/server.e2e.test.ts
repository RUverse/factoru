import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFactoruClient, FactoruProtocolError, PROTOCOL_VERSION } from '@factoru/protocol'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './app.js'
import { ensureServerId } from './identity.js'
import { SERVER_VERSION } from './version.js'

/**
 * The Milestone 0 exit criterion end to end: a real HTTP listener, the real
 * shared protocol client, real runtime validation on both sides. Only Electron's
 * IPC hop is left out; `connection-runtime.test.ts` covers the desktop side of
 * that boundary against the same client contract.
 */
let app: FastifyInstance | undefined
let dataDir: string | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  if (dataDir !== undefined) {
    await rm(dataDir, { recursive: true, force: true })
    dataDir = undefined
  }
})

async function startServer() {
  dataDir = await mkdtemp(path.join(tmpdir(), 'factoru-e2e-'))
  const serverId = await ensureServerId(dataDir)

  app = buildServer({ serverId, logLevel: 'silent' })
  const address = await app.listen({ host: '127.0.0.1', port: 0 })

  return {
    serverId,
    client: createFactoruClient({
      baseUrl: address,
      clientName: 'factoru-desktop',
      clientVersion: '0.0.0',
      timeoutMs: 2_000,
    }),
  }
}

describe('desktop to server over HTTP', () => {
  it('reads the health and version of a locally started server', async () => {
    const { serverId, client } = await startServer()

    const health = await client.health()

    expect(health.serverId).toBe(serverId)
    expect(health.serverVersion).toBe(SERVER_VERSION)
    expect(health.status).toBe('ok')
    expect(health.uptimeMs).toBeGreaterThanOrEqual(0)
  })

  it('completes a compatible handshake', async () => {
    const { serverId, client } = await startServer()

    const { response, compatibility } = await client.handshake()

    expect(response.server.serverId).toBe(serverId)
    expect(response.compatible).toBe(true)
    expect(compatibility.compatible).toBe(true)
    expect(compatibility.negotiatedProtocolVersion).toBe(PROTOCOL_VERSION)
  })

  it('keeps the same identity across a server restart', async () => {
    const first = await startServer()
    const before = await first.client.health()

    await app?.close()
    app = buildServer({ serverId: await ensureServerId(dataDir!), logLevel: 'silent' })
    const address = await app.listen({ host: '127.0.0.1', port: 0 })

    const after = await createFactoruClient({
      baseUrl: address,
      clientName: 'factoru-desktop',
      clientVersion: '0.0.0',
    }).health()

    expect(after.serverId).toBe(before.serverId)
  })

  it('reports an unreachable server as a retryable transport error', async () => {
    const client = createFactoruClient({
      // Port 1 is privileged and unbound in test environments.
      baseUrl: 'http://127.0.0.1:1',
      clientName: 'factoru-desktop',
      clientVersion: '0.0.0',
      timeoutMs: 1_000,
    })

    const error = await client.health().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FactoruProtocolError)
    expect((error as FactoruProtocolError).retryable).toBe(true)
  })

  it('answers an unknown operation with a structured problem', async () => {
    const { client } = await startServer()

    const response = await fetch(`${client.baseUrl}/api/v1/projects`)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})
