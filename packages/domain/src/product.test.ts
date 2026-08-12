import { describe, expect, it } from 'vitest'
import {
  MODEL_SLOTS,
  PROJECT_BLUEPRINTS,
  SOFTWARE_PROJECT_TEMPLATE,
  WORKFLOW_PRESETS,
  isModelSlotForWorker,
  resolveWorkflowPreset,
  validateProjectBlueprintCatalog,
  validateWorkflowPresetLaunch,
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

describe('Blueprint workflow catalog', () => {
  it('validates the built-in manifests and recommends Standard Software Project', () => {
    expect(() =>
      validateProjectBlueprintCatalog(PROJECT_BLUEPRINTS, WORKFLOW_PRESETS),
    ).not.toThrow()
    expect(PROJECT_BLUEPRINTS.find((blueprint) => blueprint.recommended)).toMatchObject({
      id: 'standard-software-project',
      defaultWorkflowPresetId: 'standard-build',
    })
  })

  it('resolves Blueprint to project default to an explicit task choice', () => {
    expect(
      resolveWorkflowPreset({
        blueprintId: 'standard-software-project',
        projectDefaultWorkflowPresetId: 'standard-build',
        taskWorkflowPresetId: null,
        taskSelectionSource: 'blueprint_default',
        taskLockedByUser: false,
      }),
    ).toMatchObject({ preset: { id: 'standard-build' }, source: 'project_default' })
    expect(
      resolveWorkflowPreset({
        blueprintId: 'standard-software-project',
        projectDefaultWorkflowPresetId: 'standard-build',
        taskWorkflowPresetId: 'fast-patch',
        taskSelectionSource: 'user',
        taskLockedByUser: true,
      }),
    ).toMatchObject({ preset: { id: 'fast-patch' }, source: 'user', lockedByUser: true })
  })

  it('rejects launch variables that exceed the preset capability policy', () => {
    const variables = {
      task_id: 'task_1',
      run_id: 'run_1',
      request: 'Build it',
      capsule_path: '/capsule',
      evidence_path: '/evidence',
      verification_script: '/verify',
      interaction_mode: 'autonomous',
      drain_policy: 'same-session',
      max_iterations: 6,
      push: false,
      open_pr: false,
    }
    expect(() =>
      validateWorkflowPresetLaunch({
        presetId: 'standard-build',
        formulaName: 'standard-build',
        launchMode: 'attached',
        variables,
      }),
    ).not.toThrow()
    expect(() =>
      validateWorkflowPresetLaunch({
        presetId: 'standard-build',
        formulaName: 'standard-build',
        launchMode: 'attached',
        variables: { ...variables, push: true },
      }),
    ).toThrow(/capability_policy/)
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
