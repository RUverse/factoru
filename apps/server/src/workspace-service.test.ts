import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FactoruDatabase } from '@factoru/database'
import { parseServerId } from '@factoru/domain'
import type { ProjectRuntimeConfigurator } from '@factoru/gas-city'
import type { ProjectManagerOrchestrator } from './workspace-service.js'
import { WorkspaceService } from './workspace-service.js'

const directories: string[] = []

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-workspace-service-'))
  directories.push(directory)
  const db = new FactoruDatabase(
    path.join(directory, 'factoru.sqlite'),
    parseServerId('srv_11111111111111111111111111111111'),
    { now: () => new Date('2026-08-06T10:00:00.000Z') },
  )
  db.createPairingCode('ABCD-EFGH-JKMN', new Date('2026-08-06T11:00:00.000Z'))
  const device = db.exchangePairingCode('ABCD-EFGH-JKMN', 'Owner’s Mac')!.device
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

function fakeOrchestrator() {
  let sentMessageId = ''
  const orchestrator: ProjectManagerOrchestrator = {
    registerConversationAdapter: vi.fn(async () => undefined),
    bindConversation: vi.fn(async () => undefined),
    sendConversationTurn: vi.fn(async (_conversation, turn) => {
      sentMessageId = turn.messageId
    }),
    readConversation: vi.fn(async (_conversation, afterSequence) =>
      afterSequence === 0 && sentMessageId
        ? [
            {
              sequence: 1,
              providerMessageId: sentMessageId,
              role: 'user' as const,
              text: 'Plan the next slice.',
              authorDisplayName: 'Owner’s Mac',
              inReplyToMessageId: undefined,
              createdAt: '2026-08-06T10:00:00.000Z',
            },
            {
              sequence: 2,
              providerMessageId: 'pm-reply-1',
              role: 'assistant' as const,
              text: 'I will inspect the roadmap first.',
              authorDisplayName: 'Project Manager',
              inReplyToMessageId: sentMessageId,
              createdAt: '2026-08-06T10:00:01.000Z',
            },
          ]
        : [],
    ),
    startRun: vi.fn(async () => ({
      cityName: 'factoru-city',
      rigName: 'factoru-rig',
      runId: 'run-plan-1',
      workflowRootBeadId: 'bead-plan-1',
      formulaName: 'factoru-planner-probe',
      formulaHash: 'hash-plan-1',
      startingEventSeq: 8,
    })),
    describeRun: vi.fn(async () => ({
      runId: 'run-plan-1',
      workflowRootBeadId: 'bead-plan-1',
      partial: false,
      steps: [{ stepId: 'probe', title: 'Probe', status: 'running' as const }],
    })),
    cancelRun: vi.fn(async () => undefined),
  }
  return orchestrator
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('WorkspaceService', () => {
  it('projects the built-in Factory and permits only valid named model slots', () => {
    const { db, project } = fixture()
    const service = new WorkspaceService(db, fakeOrchestrator())
    expect(service.get(project.id)).toMatchObject({
      projectId: project.id,
      factory: { maxParallelImplementationWorkers: 1 },
      workerTypes: [{ kind: 'project_manager' }, { kind: 'software_engineer' }],
      conversation: { messages: [] },
    })
    expect(
      service.updateModelBinding({
        projectId: project.id,
        workerTypeKind: 'software_engineer',
        slot: 'review',
        provider: 'openai',
        model: 'codex',
      }),
    ).toMatchObject({
      kind: 'software_engineer',
      modelBindings: expect.arrayContaining([
        expect.objectContaining({ slot: 'review', provider: 'openai', model: 'codex' }),
      ]),
    })
    expect(() =>
      service.updateModelBinding({
        projectId: project.id,
        workerTypeKind: 'project_manager',
        slot: 'review',
        provider: 'openai',
        model: 'codex',
      }),
    ).toThrow(/does not belong/)
    db.close()
  })

  it('durably queues a turn, delivers it, and resumes transcript storage by cursor', async () => {
    const { db, project } = fixture()
    const orchestrator = fakeOrchestrator()
    const service = new WorkspaceService(db, orchestrator)
    const accepted = service.sendMessage(project.id, 'Plan the next slice.', 'Owner’s Mac')
    expect(accepted.deliveryState).toBe('pending')
    expect(
      db.connection
        .prepare("SELECT status FROM outbox_items WHERE kind = 'conversation.deliver'")
        .get(),
    ).toEqual({ status: 'pending' })

    await service.process()

    const workspace = service.get(project.id)
    expect(workspace.conversation.transcriptCursor).toBe(2)
    expect(workspace.conversation.messages).toHaveLength(2)
    expect(workspace.conversation.messages[0]).toMatchObject({
      id: accepted.id,
      deliveryState: 'delivered',
    })
    expect(workspace.conversation.messages[1]).toMatchObject({
      role: 'assistant',
      text: 'I will inspect the roadmap first.',
    })
    expect(orchestrator.bindConversation).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: 'factoru-rig' }),
      'project-manager-chat-111111111111',
    )
    db.close()
  })

  it('coalesces one planner probe without blocking chat', async () => {
    const { db, project } = fixture()
    const orchestrator = fakeOrchestrator()
    const service = new WorkspaceService(db, orchestrator)
    const first = await service.startPlannerProbe(project.id)
    const repeated = await service.startPlannerProbe(project.id)
    expect(repeated.id).toBe(first.id)
    expect(orchestrator.startRun).toHaveBeenCalledTimes(1)
    expect(service.sendMessage(project.id, 'Are you still there?', 'Owner’s Mac')).toMatchObject({
      deliveryState: 'pending',
    })
    expect(await service.cancelPlannerProbe(project.id, first.id)).toMatchObject({
      status: 'cancelling',
    })
    expect(orchestrator.cancelRun).toHaveBeenCalledWith('run-plan-1')
    db.close()
  })

  it('keeps provenance with bounded project memory', () => {
    const { db, project } = fixture()
    const service = new WorkspaceService(db, fakeOrchestrator())
    expect(
      service.addMemory({
        projectId: project.id,
        scope: 'worker_type',
        workerTypeKind: 'project_manager',
        content: 'Ask before changing product scope.',
        provenanceRef: 'workspace:memory-editor',
      }),
    ).toMatchObject({
      scope: 'worker_type',
      provenance: { kind: 'user_edit', ref: 'workspace:memory-editor' },
    })
    db.close()
  })

  it('surfaces rejected runtime configuration without attempting chat delivery', async () => {
    const { db, project } = fixture()
    const orchestrator = fakeOrchestrator()
    const configurator: ProjectRuntimeConfigurator = {
      reconcile: vi.fn(async () => {
        throw new Error('provider model is not supported')
      }),
    }
    const service = new WorkspaceService(db, orchestrator, configurator)

    await service.process()

    expect(service.get(project.id).conversation).toMatchObject({
      status: 'needs_attention',
      error: {
        code: 'runtime_configuration_failed',
        message: 'provider model is not supported',
      },
    })
    expect(orchestrator.registerConversationAdapter).not.toHaveBeenCalled()
    db.close()
  })
})
