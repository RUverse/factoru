// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionRun, RunDetail, Task } from '@factoru/protocol'
import { RunInspector } from './RunInspector'

let mounted: { root: ReturnType<typeof createRoot>; container: HTMLDivElement } | null = null
afterEach(() => {
  if (mounted) act(() => mounted!.root.unmount())
  mounted?.container.remove()
  mounted = null
})

describe('RunInspector', () => {
  it('renders progressive orchestration detail and restores actions without raw identities', () => {
    const now = '2026-08-12T10:00:00.000Z'
    const usage = {
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostUsd: 0.01,
      pricing: 'priced' as const,
    }
    const run = {
      id: 'run_1',
      taskId: 'task_1',
      formulaName: 'standard-build',
      formulaVersion: '1',
      formulaHash: 'hash',
      workflowPresetId: 'standard-build',
      workflowPresetVersion: 1,
      resolvedVariables: {},
      blueprintId: 'standard-software-project',
      blueprintVersion: 1,
      packLockDigest: 'digest',
      sourceBeadId: null,
      status: 'running',
      stage: 'review',
      capsule: null,
      steps: [],
      logs: [],
      usage,
      reviewPackage: null,
      error: null,
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    } as ExecutionRun
    const task = {
      id: 'task_1',
      projectId: 'project_1',
      title: 'Inspect me',
      description: '',
      status: 'in_progress',
      queuePhase: null,
      priority: 0,
      queueOrder: 0,
      workerTypeKind: 'software_engineer',
      formulaName: 'standard-build',
      workflowPresetId: 'standard-build',
      workflowSelectionSource: 'pm',
      workflowLockedByUser: false,
      needsYouAction: null,
      needsYouMessage: null,
      resolution: null,
      resolutionSummary: null,
      resolvedAt: null,
      mergedIntoTaskId: null,
      source: 'user',
      dependencyIds: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    } as Task
    const detail = {
      summary: run,
      projection: {
        completeness: 'partial',
        cursor: 3,
        lastCompleteCursor: 2,
        reconciledAt: now,
        reason: 'session page unavailable',
      },
      formula: {
        name: 'standard-build',
        version: '1',
        hash: 'hash',
        stages: [
          {
            id: 'review',
            title: 'Review',
            ordinal: 0,
            status: 'running',
            attempt: 1,
            maxAttempts: 6,
          },
        ],
        edges: [{ from: 'verify', to: 'review' }],
      },
      convoy: {
        id: 'opaque-convoy',
        drainPolicy: 'same-session',
        singleLane: true,
        units: [
          {
            id: 'unit-1',
            title: 'API unit',
            ordinal: 0,
            status: 'completed',
            dependencyIds: [],
            sessionId: null,
            attempt: 1,
          },
        ],
      },
      sessions: [
        {
          id: 'opaque-session',
          purpose: 'security_reliability',
          status: 'running',
          excerpts: [
            {
              sequence: 1,
              role: 'assistant',
              text: 'bounded evidence',
              redacted: true,
              createdAt: now,
            },
          ],
        },
      ],
      artifacts: [
        {
          id: 'artifact-1',
          kind: 'review',
          label: 'Security report',
          mediaType: 'application/json',
          sizeBytes: 20,
          available: true,
          createdAt: now,
        },
      ],
      specialistReports: [
        {
          id: 'report-1',
          lane: 'security_reliability',
          status: 'approved',
          summary: 'Approved',
          findings: [],
          artifactId: 'artifact-1',
        },
      ],
      synthesis: {
        status: 'running',
        summary: 'Synthesizing',
        requestedCorrections: [],
        artifactId: null,
      },
      budgets: {
        verification: { used: 1, limit: 2 },
        correction: { used: 2, limit: 6 },
        transient: { used: 0, limit: 6 },
      },
      usage,
      cancellation: { requestedAt: null, confirmedAt: null },
      recovery: { state: 'replaying', message: 'recovering' },
    } as RunDetail
    const onBack = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted = { root, container }
    act(() =>
      root.render(
        <RunInspector
          task={task}
          run={run}
          detail={detail}
          connected
          busy={false}
          onBack={onBack}
          onCancel={vi.fn()}
          onApprove={vi.fn()}
          onRequestChanges={vi.fn()}
          onRetry={vi.fn()}
          onArchive={vi.fn()}
        />,
      ),
    )
    expect(container.textContent).toContain('Projection partial · session page unavailable')
    expect(container.textContent).toContain('security reliability')
    expect(container.textContent).toContain('same-session')
    expect(container.textContent).not.toContain('/Users/')
    act(() => (container.querySelector('.back-button') as HTMLButtonElement).click())
    expect(onBack).toHaveBeenCalledOnce()
  })
})
