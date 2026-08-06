import { describe, expect, it } from 'vitest'
import {
  MODEL_SLOTS,
  SOFTWARE_PROJECT_TEMPLATE,
  isModelSlotForWorker,
  validateWorkerType,
  queuePhaseForStatus,
  taskCandidateScore,
  validateTaskState,
} from './product.js'

describe('software project template', () => {
  it('keeps the MVP worker contracts and capacity serial', () => {
    expect(SOFTWARE_PROJECT_TEMPLATE.factory.maxParallelImplementationWorkers).toBe(1)
    expect(SOFTWARE_PROJECT_TEMPLATE.workerTypes.map((worker) => worker.kind)).toEqual([
      'project_manager',
      'software_engineer',
    ])
    for (const worker of SOFTWARE_PROJECT_TEMPLATE.workerTypes) {
      expect(() => validateWorkerType(worker)).not.toThrow()
      expect(worker.modelBindings.map((binding) => binding.slot)).toEqual(MODEL_SLOTS[worker.kind])
    }
  })

  it('rejects a cross-worker model slot', () => {
    expect(isModelSlotForWorker('project_manager', 'review')).toBe(false)
    expect(() =>
      validateWorkerType({
        ...SOFTWARE_PROJECT_TEMPLATE.workerTypes[0]!,
        modelBindings: [{ slot: 'review', provider: null, model: null }],
      }),
    ).toThrow(/Invalid model slots/)
  })

  it('requires provenance-aware memory', () => {
    expect(() =>
      validateWorkerType({
        ...SOFTWARE_PROJECT_TEMPLATE.workerTypes[0]!,
        memoryPolicy: 'automatic' as never,
      }),
    ).toThrow(/provenance/)
  })
})

describe('task lifecycle', () => {
  it('keeps Queue phase detail separate from the four active statuses', () => {
    expect(queuePhaseForStatus('queue')).toBe('awaiting_triage')
    expect(queuePhaseForStatus('backlog')).toBeNull()
    expect(() =>
      validateTaskState({
        status: 'queue',
        queuePhase: null,
        needsYouAction: null,
        needsYouMessage: null,
        resolution: null,
      }),
    ).toThrow(/Queue phase/)
  })

  it('requires Needs you to name the exact requested action', () => {
    expect(() =>
      validateTaskState({
        status: 'needs_you',
        queuePhase: null,
        needsYouAction: 'clarify',
        needsYouMessage: 'Which platforms must this support?',
        resolution: null,
      }),
    ).not.toThrow()
    expect(() =>
      validateTaskState({
        status: 'needs_you',
        queuePhase: null,
        needsYouAction: null,
        needsYouMessage: null,
        resolution: null,
      }),
    ).toThrow(/exact user action/)
  })

  it('scores simple duplicate candidates without a model dependency', () => {
    expect(taskCandidateScore('Add dark mode settings', 'Dark mode for settings')).toBeGreaterThan(
      0.7,
    )
    expect(taskCandidateScore('Add dark mode', 'Fix database migration')).toBe(0)
  })
})
