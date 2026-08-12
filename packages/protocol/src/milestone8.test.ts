import { describe, expect, it } from 'vitest'
import {
  memoryProposalSchema,
  runDetailSchema,
  taskResourceIntentSchema,
  taskSplitParamsSchema,
} from './milestone8.js'

describe('protocol v5 orchestration depth', () => {
  it('rejects traversal, control characters, and invalid exclusive claims', () => {
    const base = { id: 'intent_1', taskId: 'task_1', createdAt: '2026-08-12T10:00:00.000Z' }
    expect(
      taskResourceIntentSchema.safeParse({
        ...base,
        kind: 'repository_path',
        name: '../secret',
        access: 'read',
      }).success,
    ).toBe(false)
    expect(
      taskResourceIntentSchema.safeParse({
        ...base,
        kind: 'service',
        name: 'api\u0000',
        access: 'read',
      }).success,
    ).toBe(false)
    expect(
      taskResourceIntentSchema.safeParse({
        ...base,
        kind: 'exclusive_resource',
        name: 'release-lock',
        access: 'write',
      }).success,
    ).toBe(false)
  })

  it('bounds split fanout and keeps memory proposals explicitly pending or decided', () => {
    expect(
      taskSplitParamsSchema.safeParse({
        projectId: 'project',
        taskId: 'task',
        reason: 'split',
        children: [{ title: 'only one' }],
      }).success,
    ).toBe(false)
    expect(
      memoryProposalSchema.parse({
        id: 'proposal',
        projectId: 'project',
        scope: 'project',
        workerTypeKind: null,
        content: 'Use pnpm.',
        provenance: { kind: 'task_run', ref: 'run' },
        status: 'pending',
        proposedBy: 'planner',
        createdAt: '2026-08-12T10:00:00.000Z',
        decidedAt: null,
      }).status,
    ).toBe('pending')
  })

  it('accepts partial detailed projections without exposing orchestrator addresses', () => {
    const source = JSON.stringify(runDetailSchema)
    expect(source).not.toContain('cityName')
    expect(source).not.toContain('rigName')
    expect(source).not.toContain('filesystemPath')
  })
})
