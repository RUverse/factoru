import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseServerId } from '@factoru/domain'
import { FactoruDatabase } from './database.js'

const directories: string[] = []

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-product-store-'))
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
  return { db, project }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('Milestone 3 product persistence', () => {
  it('initializes the built-in Factory Template atomically with a project', () => {
    const { db, project } = fixture()
    expect(db.product.factorySettings(project.id)).toEqual({
      templateId: 'software-project',
      templateVersion: 1,
      maxParallelImplementationWorkers: 1,
      executionWipLimit: 1,
      queueRevision: 0,
    })
    const workers = db.product.listWorkerTypes(project.id)
    expect(workers.map((worker) => worker.kind)).toEqual(['project_manager', 'software_engineer'])
    expect(workers.find((worker) => worker.kind === 'project_manager')?.modelBindings).toHaveLength(
      2,
    )
    expect(db.product.getConversation(project.id)).toMatchObject({
      id: 'conv_11111111111111111111111111111111',
      projectId: project.id,
      transcriptCursor: 0,
    })
    db.close()
  })

  it('validates named model slots and records a product event', () => {
    const { db, project } = fixture()
    const updated = db.product.updateModelBinding(
      project.id,
      'software_engineer',
      'implementation',
      'anthropic',
      'claude-sonnet',
    )
    expect(
      updated.modelBindings.find((binding) => binding.slot === 'implementation'),
    ).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet', version: 2 })
    expect(() =>
      db.product.updateModelBinding(project.id, 'project_manager', 'review', 'openai', 'codex'),
    ).toThrow('invalid_model_slot')
    expect(db.eventsAfter(1).map((event) => event.type)).toContain(
      'worker_type.model_binding_updated',
    )
    db.close()
  })

  it('persists messages idempotently by Gas City sequence and advances its cursor', () => {
    const { db, project } = fixture()
    const conversation = db.product.getConversation(project.id)!
    const pending = db.product.addUserMessage(conversation.id, '  Ship it  ', 'Owner')
    expect(pending).toMatchObject({ text: 'Ship it', deliveryState: 'pending' })

    const transcript = {
      sequence: 4,
      role: 'assistant' as const,
      text: 'Working on it.',
      authorDisplayName: 'Project Manager',
      createdAt: '2026-08-06T10:01:00.000Z',
    }
    expect(db.product.storeTranscriptMessage(conversation.id, transcript)).toEqual(
      db.product.storeTranscriptMessage(conversation.id, transcript),
    )
    expect(db.product.getConversation(project.id)?.transcriptCursor).toBe(4)
    expect(db.product.listMessages(conversation.id)).toHaveLength(2)
    db.close()
  })

  it('requires provenance and versions durable memory', () => {
    const { db, project } = fixture()
    expect(() =>
      db.product.addMemoryEntry({
        projectId: project.id,
        scope: 'project',
        content: 'Use pnpm.',
        provenanceKind: 'user_edit',
        provenanceRef: '',
      }),
    ).toThrow('memory_provenance_required')
    const first = db.product.addMemoryEntry({
      projectId: project.id,
      scope: 'project',
      content: 'Use pnpm.',
      provenanceKind: 'user_edit',
      provenanceRef: 'settings:memory',
    })
    const second = db.product.addMemoryEntry({
      projectId: project.id,
      scope: 'project',
      content: 'Use pnpm 11.',
      provenanceKind: 'user_edit',
      provenanceRef: 'settings:memory',
      supersedesId: first.id,
    })
    expect(second).toMatchObject({ version: 2, supersedesId: first.id })
    expect(db.product.listMemory(project.id)).toHaveLength(2)
    db.close()
  })
})
