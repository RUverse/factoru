import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { FactoruDatabase } from '@factoru/database'
import { parseServerId } from '@factoru/domain'
import { CONNECTION_TICKET_PATH, PAIRING_EXCHANGE_PATH } from '@factoru/protocol'
import { buildServer } from './app.js'
import { ProjectService } from './project-service.js'
import { RepositoryService } from './repositories.js'

const directories: string[] = []
afterEach(() => {
  for (const value of directories.splice(0)) fs.rmSync(value, { recursive: true })
})

describe('authenticated live API', () => {
  it('consumes a one-time ticket and returns a bounded project snapshot', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-live-'))
    directories.push(directory)
    const serverId = parseServerId('srv_11111111111111111111111111111111')
    const database = new FactoruDatabase(path.join(directory, 'factoru.sqlite'), serverId)
    database.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
    const service = new ProjectService({
      database,
      repositories: new RepositoryService([]),
      registrar: { register: async () => undefined },
      cityName: 'factoru-test',
      cityPath: path.join(directory, 'city'),
    })
    const app = buildServer({ serverId, database, projectService: service, logLevel: 'silent' })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
    const paired = await app.inject({
      method: 'POST',
      url: PAIRING_EXCHANGE_PATH,
      payload: { code: 'ABCD-EFGH-JKMN', deviceName: 'Mac' },
    })
    const ticket = await app.inject({
      method: 'POST',
      url: CONNECTION_TICKET_PATH,
      headers: { authorization: `Bearer ${paired.json().token as string}` },
    })
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/v1/live?ticket=${ticket.json().ticket as string}`,
    )
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    const response = new Promise<unknown>((resolve) =>
      socket.once('message', (raw) => resolve(JSON.parse(raw.toString()))),
    )
    socket.send(
      JSON.stringify({ id: 'one', method: 'projects.subscribe', params: { afterCursor: 0 } }),
    )
    expect(await response).toEqual({
      id: 'one',
      ok: true,
      result: { projects: [], cursor: 0, resynchronized: false, events: [] },
    })

    const revokedTicket = await app.inject({
      method: 'POST',
      url: CONNECTION_TICKET_PATH,
      headers: { authorization: `Bearer ${paired.json().token as string}` },
    })
    const confirmationRequired = new Promise<unknown>((resolve) =>
      socket.once('message', (raw) => resolve(JSON.parse(raw.toString()))),
    )
    socket.send(
      JSON.stringify({
        id: 'revoke-without-confirmation',
        method: 'devices.revoke',
        params: { deviceId: paired.json().device.id },
      }),
    )
    expect(await confirmationRequired).toMatchObject({
      ok: false,
      error: { code: 'confirmation_required' },
    })
    const selfRevoked = new Promise<unknown>((resolve) =>
      socket.once('message', (raw) => resolve(JSON.parse(raw.toString()))),
    )
    const selfRevokedClose = new Promise<number>((resolve) => socket.once('close', resolve))
    socket.send(
      JSON.stringify({
        id: 'revoke-with-confirmation',
        method: 'devices.revoke',
        params: { deviceId: paired.json().device.id, confirmSelf: true },
      }),
    )
    expect(await selfRevoked).toMatchObject({ ok: true, result: { revoked: true, self: true } })
    expect(await selfRevokedClose).toBe(1008)

    const replay = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/v1/live?ticket=${ticket.json().ticket as string}`,
    )
    const closeCode = new Promise<number>((resolve) => replay.once('close', resolve))
    expect(await closeCode).toBe(1008)

    const revoked = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/v1/live?ticket=${revokedTicket.json().ticket as string}`,
    )
    const revokedCloseCode = new Promise<number>((resolve) => revoked.once('close', resolve))
    expect(await revokedCloseCode).toBe(1008)
    await app.close()
    database.close()
  })
})
