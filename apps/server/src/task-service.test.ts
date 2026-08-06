import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FactoruDatabase } from '@factoru/database'
import { parseServerId } from '@factoru/domain'
import { TaskService } from './task-service.js'

const directories: string[] = []

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-task-service-'))
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
    requestHash: 'task-service-fixture',
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
  return { database, service: new TaskService(database), device, project }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('TaskService', () => {
  it('projects direct capture and Queue edits from authoritative state', () => {
    const { database, service, device, project } = fixture()
    const task = service.create(
      { projectId: project.id, title: 'Capture this', status: 'backlog' },
      device.id,
    )
    expect(
      service.move({ projectId: project.id, taskId: task.id, status: 'queue' }, device.id),
    ).toMatchObject({ status: 'queue', queuePhase: 'awaiting_triage' })
    expect(
      service.update(
        { projectId: project.id, taskId: task.id, description: 'Acceptance criteria' },
        device.id,
      ),
    ).toMatchObject({ description: 'Acceptance criteria', version: 3 })
    database.close()
  })

  it('never returns task candidates from another project scope', () => {
    const { database, service, device, project } = fixture()
    service.create(
      { projectId: project.id, title: 'Project-local dark mode', status: 'backlog' },
      device.id,
    )
    expect(service.search(project.id, 'dark mode', 8)).toHaveLength(1)
    expect(() => service.search('prj_missing', 'dark mode', 8)).toThrow(/Project not found/)
    database.close()
  })

  it('turns merge decisions into durable user-confirmed resolutions', () => {
    const { database, service, device, project } = fixture()
    const source = service.create(
      { projectId: project.id, title: 'Dark theme', status: 'backlog' },
      device.id,
    )
    const target = service.create(
      { projectId: project.id, title: 'Color themes', status: 'backlog' },
      device.id,
    )
    const proposal = database.tasks.proposeMerge({
      projectId: project.id,
      sourceTaskId: source.id,
      targetTaskId: target.id,
      reason: 'These overlap.',
      proposedBy: 'planner-session',
      actorKind: 'pm_planner',
    })

    expect(
      service.decideMerge(
        { projectId: project.id, proposalId: proposal.id, decision: 'accept' },
        device.id,
      ),
    ).toMatchObject({ status: 'accepted' })
    expect(database.tasks.get(source.id)).toMatchObject({
      resolution: 'superseded',
      mergedIntoTaskId: target.id,
    })
    database.close()
  })
})
