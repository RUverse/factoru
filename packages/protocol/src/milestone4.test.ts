import { describe, expect, it } from 'vitest'
import { taskMoveParamsSchema, taskSchema, taskStatusSchema, workspaceSchema } from './index.js'

const task = {
  id: 'task_1',
  projectId: 'prj_1',
  title: 'Build task board',
  description: '',
  status: 'queue',
  queuePhase: 'awaiting_triage',
  priority: 0,
  queueOrder: 0,
  workerTypeKind: null,
  formulaName: null,
  needsYouAction: null,
  needsYouMessage: null,
  resolution: null,
  resolutionSummary: null,
  resolvedAt: null,
  mergedIntoTaskId: null,
  source: 'user',
  dependencyIds: [],
  version: 1,
  createdAt: '2026-08-06T10:00:00.000Z',
  updatedAt: '2026-08-06T10:00:00.000Z',
}

describe('Milestone 4 task protocol', () => {
  it('accepts exactly four active statuses and rejects done', () => {
    expect(taskStatusSchema.options).toEqual(['backlog', 'queue', 'in_progress', 'needs_you'])
    expect(taskStatusSchema.safeParse('done').success).toBe(false)
  })

  it('validates Queue phase and exact Needs you actions', () => {
    expect(taskSchema.parse(task)).toMatchObject({ status: 'queue' })
    expect(taskSchema.safeParse({ ...task, queuePhase: null }).success).toBe(false)
    expect(
      taskMoveParamsSchema.safeParse({ projectId: 'prj_1', taskId: 'task_1', status: 'needs_you' })
        .success,
    ).toBe(false)
  })

  it('keeps old cached workspaces readable with empty task defaults', () => {
    const workspace = workspaceSchema.parse({
      projectId: 'prj_1',
      factory: {
        templateId: 'software-project',
        templateVersion: 1,
        maxParallelImplementationWorkers: 1,
      },
      workerTypes: [],
      conversation: {
        id: 'conv_1',
        status: 'ready',
        error: null,
        messages: [],
        transcriptCursor: 0,
        updatedAt: '2026-08-06T10:00:00.000Z',
      },
      memory: [],
      plannerProbe: null,
    })
    expect(workspace).toMatchObject({
      tasks: [],
      recentTaskResolutions: [],
      queueReconciliation: null,
      taskMergeProposals: [],
    })
  })
})
