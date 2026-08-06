import { describe, expect, it } from 'vitest'
import { executionRunSchema } from './milestone5.js'

describe('software-delivery protocol', () => {
  it('requires durable correlation and an exact review package shape', () => {
    const run = {
      id: 'run_1',
      taskId: 'task_1',
      formulaName: 'software-delivery',
      formulaVersion: '0.3.0',
      formulaHash: 'abc',
      status: 'completed',
      stage: 'needs_you',
      capsule: {
        id: 'capsule_1',
        path: '/tmp/worktree',
        branchName: 'factoru/x',
        baseBranch: 'dev',
      },
      steps: [{ id: 'review', title: 'Review', status: 'completed' }],
      logs: ['Checks\nok'],
      usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.1 },
      reviewPackage: {
        request: 'Make a change',
        plan: 'Change one file',
        diff: 'diff',
        commits: ['abc change'],
        checks: { status: 'passed', output: 'ok' },
        internalReview: 'APPROVE',
        unresolvedRisks: [],
        usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.1 },
        capsulePath: '/tmp/worktree',
        branchName: 'factoru/x',
      },
      error: null,
      createdAt: '2026-08-06T10:00:00.000Z',
      startedAt: '2026-08-06T10:01:00.000Z',
      finishedAt: '2026-08-06T10:05:00.000Z',
      updatedAt: '2026-08-06T10:05:00.000Z',
    }
    expect(executionRunSchema.safeParse(run).success).toBe(true)
    expect(executionRunSchema.safeParse({ ...run, stage: 'done' }).success).toBe(false)
  })
})
