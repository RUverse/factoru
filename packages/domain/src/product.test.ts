import { describe, expect, it } from 'vitest'
import {
  MODEL_SLOTS,
  SOFTWARE_PROJECT_TEMPLATE,
  isModelSlotForWorker,
  validateWorkerType,
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
