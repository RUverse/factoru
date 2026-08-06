import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FactoruDatabase } from '@factoru/database'
import { parseServerId } from '@factoru/domain'
import { AgentToolService } from './agent-tool-service.js'

const directories: string[] = []

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-agent-tools-'))
  directories.push(directory)
  const database = new FactoruDatabase(
    path.join(directory, 'factoru.sqlite'),
    parseServerId('srv_11111111111111111111111111111111'),
  )
  database.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
  const device = database.exchangePairingCode('ABCD-EFGH-JKMN', 'Mac')!.device
  const project = database.createProject({
    commandId: 'cmd_create',
    deviceId: device.id,
    requestHash: 'agent-tool-fixture',
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
  return { database, project, service: new AgentToolService(database) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('AgentToolService', () => {
  it('mints a project/role session credential and replays one audited mutation', () => {
    const { database, service, project } = fixture()
    const session = service.createSession({
      rigName: project.rig.rigName,
      agentName: 'factoru.project-manager-chat',
      sessionId: 'session-chat-1',
    })
    expect(session).toMatchObject({ projectId: project.id, role: 'pm_chat' })
    const request = {
      requestId: 'call-1',
      tool: 'tasks.create',
      arguments: { title: 'Created from chat', status: 'backlog' },
    }
    const first = service.call(session.token, request)
    expect(first).toMatchObject({ ok: true, result: { title: 'Created from chat' } })
    expect(service.call(session.token, request)).toEqual(first)
    expect(database.tasks.listActive(project.id)).toHaveLength(1)
    expect(database.connection.prepare('SELECT outcome FROM agent_tool_audit').all()).toEqual([
      { outcome: 'accepted' },
    ])
    database.close()
  })

  it('enforces role policy and project scope in server code', () => {
    const { database, service, project } = fixture()
    const session = service.createSession({
      rigName: project.rig.rigName,
      agentName: 'factoru.software-reviewer',
      sessionId: 'session-review-1',
    })
    expect(
      service.call(session.token, {
        requestId: 'call-denied',
        tool: 'tasks.create',
        arguments: { title: 'Escape role' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(database.tasks.listActive(project.id)).toHaveLength(0)
    expect(database.connection.prepare('SELECT outcome FROM agent_tool_audit').all()).toEqual([
      { outcome: 'denied' },
    ])
    database.close()
  })

  it('turns ambiguous merges into proposals and refuses agent supersession', () => {
    const { database, service, project } = fixture()
    const source = database.tasks.create({
      projectId: project.id,
      title: 'Dark mode',
      source: 'user',
      actorKind: 'user',
      actorId: 'owner',
    })
    const target = database.tasks.create({
      projectId: project.id,
      title: 'Theme settings',
      source: 'user',
      actorKind: 'user',
      actorId: 'owner',
    })
    const session = service.createSession({
      rigName: project.rig.rigName,
      agentName: 'factoru.project-manager-planner',
      sessionId: 'session-plan-1',
    })
    expect(
      service.call(session.token, {
        requestId: 'call-propose',
        tool: 'tasks.propose_merge',
        arguments: {
          sourceTaskId: source.id,
          targetTaskId: target.id,
          reason: 'The requests overlap.',
        },
      }),
    ).toMatchObject({ ok: true, result: { status: 'pending' } })
    expect(
      service.call(session.token, {
        requestId: 'call-supersede',
        tool: 'tasks.resolve',
        arguments: { taskId: source.id, resolution: 'superseded', summary: 'Merged.' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_tool_request' } })
    expect(database.tasks.get(source.id)?.resolution).toBeNull()
    database.close()
  })
})
