import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FactoruDatabase } from '@factoru/database'
import { parseServerId } from '@factoru/domain'
import { buildServer } from './app.js'
import { GAS_CITY_CALLBACK_BASE_PATH, GAS_CITY_CALLBACK_PATH } from './gas-city-callback.js'

const directories: string[] = []

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-gas-callback-'))
  directories.push(directory)
  const serverId = parseServerId('srv_11111111111111111111111111111111')
  const database = new FactoruDatabase(path.join(directory, 'factoru.sqlite'), serverId)
  database.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
  const device = database.exchangePairingCode('ABCD-EFGH-JKMN', 'Mac')!.device
  const project = database.createProject({
    commandId: 'cmd_create',
    deviceId: device.id,
    requestHash: 'request-hash',
    projectId: 'prj_11111111111111111111111111111111',
    name: 'Factoru',
    repositoryRootId: 'root_main',
    repositoryRelativePath: 'factoru',
    repositoryRealPath: '/srv/repos/factoru',
    defaultBranch: 'dev',
    cityName: 'factoru-city',
    rigName: 'factoru-rig',
    beadPrefix: 'fact',
  })
  const conversation = database.product.getConversation(project.id)!
  const app = buildServer({ serverId, database, logLevel: 'silent' })
  return { app, database, project, conversation }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('Gas City outbound callback', () => {
  it("keeps the registered base separate from Gas City's publish suffix", () => {
    expect(`${GAS_CITY_CALLBACK_BASE_PATH}/publish`).toBe(GAS_CITY_CALLBACK_PATH)
    expect(GAS_CITY_CALLBACK_BASE_PATH).not.toMatch(/\/publish$/)
  })

  it('acknowledges a scoped conversation idempotently without bypassing the transcript', async () => {
    const { app, database, project, conversation } = fixture()
    const payload = {
      session_id: 'fc-chat-1',
      conversation: {
        scope_id: project.rig.rigName,
        provider: 'factoru',
        account_id: conversation.gasCityAccountId,
        conversation_id: conversation.gasCityConversationId,
        kind: 'dm',
      },
      text: 'Inspect the TypeScript entrypoint first.',
      reply_to_message_id: 'msg-user-1',
      idempotency_key: 'reply-user-1',
    }
    const publish = () =>
      app.inject({
        method: 'POST',
        url: GAS_CITY_CALLBACK_PATH,
        headers: { 'x-gc-request': 'true' },
        payload,
      })

    const first = await publish()
    const second = await publish()
    expect(first.statusCode).toBe(200)
    expect(second.json()).toEqual(first.json())
    expect(first.json()).toMatchObject({
      message_id: expect.stringMatching(/^factoru-[a-f0-9]{32}$/),
      conversation: payload.conversation,
      delivered: true,
      failure_kind: '',
      retry_after: 0,
    })
    expect(database.product.listMessages(conversation.id)).toEqual([])
    await app.close()
    database.close()
  })

  it('rejects untrusted or mismatched callbacks', async () => {
    const { app, database, project, conversation } = fixture()
    const payload = {
      session_id: 'fc-chat-1',
      conversation: {
        scope_id: project.rig.rigName,
        provider: 'factoru',
        account_id: conversation.gasCityAccountId,
        conversation_id: conversation.gasCityConversationId,
        kind: 'dm',
      },
      text: 'Reply',
    }
    expect(
      (await app.inject({ method: 'POST', url: GAS_CITY_CALLBACK_PATH, payload })).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: GAS_CITY_CALLBACK_PATH,
          headers: { 'x-gc-request': 'true' },
          payload: {
            ...payload,
            conversation: { ...payload.conversation, account_id: 'another-server' },
          },
        })
      ).statusCode,
    ).toBe(404)
    await app.close()
    database.close()
  })
})
