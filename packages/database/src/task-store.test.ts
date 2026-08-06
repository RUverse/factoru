import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseServerId } from '@factoru/domain'
import { FactoruDatabase } from './database.js'

const directories: string[] = []

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-task-store-'))
  directories.push(directory)
  const db = new FactoruDatabase(
    path.join(directory, 'factoru.sqlite'),
    parseServerId('srv_11111111111111111111111111111111'),
    { now: () => new Date('2026-08-06T10:00:00.000Z') },
  )
  db.createPairingCode('ABCD-EFGH-JKMN', new Date('2026-08-06T11:00:00.000Z'))
  const device = db.exchangePairingCode('ABCD-EFGH-JKMN', 'Mac')!.device
  const project = db.createProject({
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
  return { db, project, device }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('Milestone 4 task persistence', () => {
  it('captures Backlog directly and Queue creates one coalesced reconciliation', () => {
    const { db, project, device } = fixture()
    const task = db.tasks.create({
      projectId: project.id,
      title: '  Add a task board  ',
      source: 'user',
      actorKind: 'user',
      actorId: device.id,
    })
    expect(task).toMatchObject({ title: 'Add a task board', status: 'backlog', queuePhase: null })
    expect(db.tasks.pendingReconciliation(project.id)).toBeNull()

    db.tasks.move({
      taskId: task.id,
      status: 'queue',
      actorKind: 'user',
      actorId: device.id,
    })
    db.tasks.update({
      taskId: task.id,
      description: 'Four columns, no Done column.',
      actorKind: 'user',
      actorId: device.id,
    })
    expect(db.tasks.get(task.id)).toMatchObject({
      status: 'queue',
      queuePhase: 'awaiting_triage',
    })
    expect(db.tasks.pendingReconciliation(project.id)).toMatchObject({
      requestedRevision: 1,
      coalescedThroughRevision: 2,
    })
    expect(
      db.connection
        .prepare("SELECT COUNT(*) AS count FROM outbox_items WHERE kind = 'queue.reconcile'")
        .get(),
    ).toEqual({ count: 1 })
    db.close()
  })

  it('allows one running pass and coalesces changes into one follow-up pass', () => {
    const { db, project, device } = fixture()
    const task = db.tasks.create({
      projectId: project.id,
      title: 'Plan this',
      status: 'queue',
      source: 'user',
      actorKind: 'user',
      actorId: device.id,
    })
    const pending = db.tasks.pendingReconciliation(project.id)!
    db.tasks.startReconciliation(pending.id, {
      runId: 'run-1',
      workflowRootBeadId: 'fact-plan-1',
    })
    db.tasks.update({
      taskId: task.id,
      title: 'Plan this carefully',
      actorKind: 'user',
      actorId: device.id,
    })
    db.tasks.update({
      taskId: task.id,
      priority: 80,
      actorKind: 'user',
      actorId: device.id,
    })
    expect(db.tasks.activeReconciliation(project.id)?.id).toBe(pending.id)
    expect(db.tasks.pendingReconciliation(project.id)).toMatchObject({
      requestedRevision: 2,
      coalescedThroughRevision: 3,
    })
    db.close()
  })

  it('enforces project-local dependencies and terminal resolutions leave the active board', () => {
    const { db, project, device } = fixture()
    const first = db.tasks.create({
      projectId: project.id,
      title: 'First',
      source: 'user',
      actorKind: 'user',
      actorId: device.id,
    })
    const second = db.tasks.create({
      projectId: project.id,
      title: 'Second',
      source: 'user',
      actorKind: 'user',
      actorId: device.id,
    })
    expect(
      db.tasks.setDependencies({
        taskId: second.id,
        dependencyIds: [first.id],
        actorKind: 'pm_planner',
        actorId: 'planner-session',
      }).dependencyIds,
    ).toEqual([first.id])
    expect(() =>
      db.tasks.setDependencies({
        taskId: second.id,
        dependencyIds: [second.id],
        actorKind: 'pm_planner',
        actorId: 'planner-session',
      }),
    ).toThrow(/itself/)
    db.tasks.resolve({
      taskId: first.id,
      resolution: 'superseded',
      summary: 'Combined with the second task.',
      mergedIntoTaskId: second.id,
      actorKind: 'user',
      actorId: device.id,
    })
    expect(db.tasks.listActive(project.id).map((task) => task.id)).toEqual([second.id])
    expect(db.tasks.listRecentResolved(project.id)[0]).toMatchObject({
      id: first.id,
      resolution: 'superseded',
      mergedIntoTaskId: second.id,
    })
    db.close()
  })

  it('returns bounded likely and possible duplicate candidates', () => {
    const { db, project, device } = fixture()
    db.tasks.create({
      projectId: project.id,
      title: 'Add dark mode settings',
      source: 'user',
      actorKind: 'user',
      actorId: device.id,
    })
    db.tasks.create({
      projectId: project.id,
      title: 'Repair database migrations',
      source: 'user',
      actorKind: 'user',
      actorId: device.id,
    })
    expect(db.tasks.searchCandidates(project.id, 'Dark mode for settings')).toMatchObject([
      { match: 'likely', task: { title: 'Add dark mode settings' } },
    ])
    db.close()
  })
})
