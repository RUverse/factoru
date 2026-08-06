import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FactoruDatabase } from '@factoru/database'
import { parseServerId } from '@factoru/domain'
import { buildServer } from './app.js'
import {
  AGENT_TOOL_CALL_PATH,
  AGENT_TOOL_SESSION_PATH,
  AgentToolService,
} from './agent-tool-service.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('agent-tool HTTP boundary', () => {
  it('keeps session minting loopback-only and authenticates tool calls', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-agent-tool-http-'))
    directories.push(directory)
    const serverId = parseServerId('srv_11111111111111111111111111111111')
    const database = new FactoruDatabase(path.join(directory, 'factoru.sqlite'), serverId)
    database.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
    const device = database.exchangePairingCode('ABCD-EFGH-JKMN', 'Mac')!.device
    database.createProject({
      commandId: 'cmd_create',
      deviceId: device.id,
      requestHash: 'agent-tool-http-fixture',
      projectId: 'prj_11111111111111111111111111111111',
      name: 'Factoru',
      repositoryRootId: 'root',
      repositoryRelativePath: 'factoru',
      repositoryRealPath: '/repos/factoru',
      defaultBranch: 'dev',
      cityName: 'factoru-city',
      rigName: 'factoru-rig',
      beadPrefix: 'fact',
    })
    const app = buildServer({
      serverId,
      logLevel: 'silent',
      database,
      agentToolService: new AgentToolService(database),
    })

    const session = await app.inject({
      method: 'POST',
      url: AGENT_TOOL_SESSION_PATH,
      payload: {
        rigName: 'factoru-rig',
        agentName: 'factoru.project-manager-chat',
        sessionId: 'chat-1',
      },
    })
    expect(session.statusCode).toBe(201)
    const token = session.json().token as string
    const call = await app.inject({
      method: 'POST',
      url: AGENT_TOOL_CALL_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'call-1',
        tool: 'tasks.create',
        arguments: { title: 'HTTP-created thought' },
      },
    })
    expect(call.statusCode).toBe(200)
    expect(call.json()).toMatchObject({ ok: true, result: { title: 'HTTP-created thought' } })

    const unauthorized = await app.inject({
      method: 'POST',
      url: AGENT_TOOL_CALL_PATH,
      headers: { authorization: 'Bearer invalid' },
      payload: { requestId: 'call-2', tool: 'tasks.search', arguments: { query: '*' } },
    })
    expect(unauthorized.statusCode).toBe(401)
    await app.close()
    database.close()
  })
})
