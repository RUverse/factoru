export const WORKER_TYPE_KINDS = ['project_manager', 'software_engineer'] as const
export type WorkerTypeKind = (typeof WORKER_TYPE_KINDS)[number]

export const MODEL_SLOTS = {
  project_manager: ['chat', 'planning'],
  software_engineer: ['design', 'implementation', 'review'],
} as const satisfies Record<WorkerTypeKind, readonly string[]>

export type ModelSlot = (typeof MODEL_SLOTS)[WorkerTypeKind][number]

export interface ModelBinding {
  readonly slot: ModelSlot
  /** Provider-specific identifiers are opaque outside the orchestration adapter. */
  readonly provider: string | null
  readonly model: string | null
}

export interface WorkerTypeDefinition {
  readonly kind: WorkerTypeKind
  readonly displayName: string
  readonly promptOverride: string | null
  readonly defaultFormula: string | null
  readonly capacity: number
  readonly modelBindings: readonly ModelBinding[]
  readonly allowedTools: readonly string[]
  readonly memoryPolicy: 'provenance_required'
}

export interface FactorySettings {
  readonly maxParallelImplementationWorkers: 1
}

export const WORKFLOW_PRESET_IDS = ['standard-build', 'fast-patch'] as const
export type WorkflowPresetId = (typeof WORKFLOW_PRESET_IDS)[number]

export const PROJECT_BLUEPRINT_IDS = ['standard-software-project', 'fast-patch'] as const
export type ProjectBlueprintId = (typeof PROJECT_BLUEPRINT_IDS)[number]

export type WorkflowLaunchMode = 'attached' | 'standalone'
export type WorkflowSelectionSource = 'blueprint_default' | 'project_default' | 'pm' | 'user'

export interface WorkflowPresetDefinition {
  readonly id: WorkflowPresetId
  readonly version: number
  readonly name: string
  readonly description: string
  readonly formulaName: 'standard-build' | 'software-delivery'
  readonly formulaVersion: string
  readonly launchMode: WorkflowLaunchMode
  readonly variables: Readonly<Record<string, string | number | boolean>>
  readonly capabilities: {
    readonly maxImplementationUnits: number
    readonly maxVerificationAttempts: number
    readonly maxCorrectionAttempts: number
    readonly allowPush: false
    readonly allowOpenPr: false
    readonly interactionMode: 'autonomous'
    readonly drainPolicy: 'same-session'
  }
}

export interface ProjectBlueprintDefinition {
  readonly id: ProjectBlueprintId
  readonly version: number
  readonly name: string
  readonly description: string
  readonly recommended: boolean
  readonly teamRoleKinds: readonly WorkerTypeKind[]
  readonly allowedWorkflowPresetIds: readonly WorkflowPresetId[]
  readonly defaultWorkflowPresetId: WorkflowPresetId
}

export const OFFICIAL_GAS_CITY_PACK_PIN = '3b3b89f2011e06d84459aa7bea1552382f13930a'

export const WORKFLOW_PRESETS: readonly WorkflowPresetDefinition[] = [
  {
    id: 'standard-build',
    version: 1,
    name: 'Standard Build',
    description: 'Requirements, design, decomposition, implementation, verification, and review.',
    formulaName: 'standard-build',
    formulaVersion: '1',
    launchMode: 'attached',
    variables: {
      interaction_mode: 'autonomous',
      review_mode: 'agent',
      drain_policy: 'same-session',
      max_iterations: 6,
      push: false,
      open_pr: false,
      implementation_target: 'gc.implementation-worker',
    },
    capabilities: {
      maxImplementationUnits: 20,
      maxVerificationAttempts: 2,
      maxCorrectionAttempts: 6,
      allowPush: false,
      allowOpenPr: false,
      interactionMode: 'autonomous',
      drainPolicy: 'same-session',
    },
  },
  {
    id: 'fast-patch',
    version: 1,
    name: 'Fast Patch',
    description: 'A bounded implement, verify, independent review, and finalize workflow.',
    formulaName: 'software-delivery',
    formulaVersion: '2',
    launchMode: 'standalone',
    variables: {},
    capabilities: {
      maxImplementationUnits: 1,
      maxVerificationAttempts: 2,
      maxCorrectionAttempts: 2,
      allowPush: false,
      allowOpenPr: false,
      interactionMode: 'autonomous',
      drainPolicy: 'same-session',
    },
  },
]

export const PROJECT_BLUEPRINTS: readonly ProjectBlueprintDefinition[] = [
  {
    id: 'standard-software-project',
    version: 1,
    name: 'Standard Software Project',
    description:
      'Full lifecycle delivery by default, with Fast Patch available per project or task.',
    recommended: true,
    teamRoleKinds: ['project_manager', 'software_engineer'],
    allowedWorkflowPresetIds: ['standard-build', 'fast-patch'],
    defaultWorkflowPresetId: 'standard-build',
  },
  {
    id: 'fast-patch',
    version: 1,
    name: 'Fast Patch',
    description: 'Bounded serial delivery by default, with Standard Build available when needed.',
    recommended: false,
    teamRoleKinds: ['project_manager', 'software_engineer'],
    allowedWorkflowPresetIds: ['fast-patch', 'standard-build'],
    defaultWorkflowPresetId: 'fast-patch',
  },
]

export function workflowPreset(id: string): WorkflowPresetDefinition {
  const preset = WORKFLOW_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error('workflow_preset_not_found')
  return preset
}

export function projectBlueprint(id: string): ProjectBlueprintDefinition {
  const blueprint = PROJECT_BLUEPRINTS.find((candidate) => candidate.id === id)
  if (!blueprint) throw new Error('project_blueprint_not_found')
  return blueprint
}

export function assertWorkflowPresetAllowed(
  blueprintId: string,
  presetId: string,
): asserts presetId is WorkflowPresetId {
  const blueprint = projectBlueprint(blueprintId)
  if (!blueprint.allowedWorkflowPresetIds.includes(presetId as WorkflowPresetId)) {
    throw new Error('workflow_preset_not_allowed')
  }
  workflowPreset(presetId)
}

export function validateProjectBlueprintCatalog(
  blueprints: readonly ProjectBlueprintDefinition[],
  presets: readonly WorkflowPresetDefinition[],
): void {
  const presetIds = new Set(presets.map((preset) => preset.id))
  if (presetIds.size !== presets.length) throw new Error('duplicate_workflow_preset')
  const blueprintIds = new Set(blueprints.map((blueprint) => blueprint.id))
  if (blueprintIds.size !== blueprints.length) throw new Error('duplicate_project_blueprint')
  if (blueprints.filter((blueprint) => blueprint.recommended).length !== 1) {
    throw new Error('exactly_one_recommended_blueprint_required')
  }
  for (const blueprint of blueprints) {
    if (!blueprint.allowedWorkflowPresetIds.includes(blueprint.defaultWorkflowPresetId)) {
      throw new Error('blueprint_default_must_be_allowed')
    }
    if (blueprint.allowedWorkflowPresetIds.some((presetId) => !presetIds.has(presetId))) {
      throw new Error('blueprint_references_unknown_preset')
    }
    if (
      blueprint.teamRoleKinds.length !== WORKER_TYPE_KINDS.length ||
      WORKER_TYPE_KINDS.some((kind) => !blueprint.teamRoleKinds.includes(kind))
    ) {
      throw new Error('blueprint_requires_initial_team_roles')
    }
  }
  for (const preset of presets) {
    if (
      preset.capabilities.maxImplementationUnits < 1 ||
      preset.capabilities.maxImplementationUnits > 20
    ) {
      throw new Error('workflow_implementation_limit_out_of_range')
    }
    if (
      preset.capabilities.maxVerificationAttempts < 1 ||
      preset.capabilities.maxVerificationAttempts > 2
    ) {
      throw new Error('workflow_verification_limit_out_of_range')
    }
    if (preset.capabilities.maxCorrectionAttempts > 6) {
      throw new Error('workflow_correction_limit_out_of_range')
    }
    if (preset.capabilities.allowPush || preset.capabilities.allowOpenPr) {
      throw new Error('workflow_publishing_not_allowed')
    }
  }
}

validateProjectBlueprintCatalog(PROJECT_BLUEPRINTS, WORKFLOW_PRESETS)

export function validateWorkflowPresetLaunch(input: {
  presetId: WorkflowPresetId
  formulaName: string
  launchMode: WorkflowLaunchMode
  variables: Readonly<Record<string, string | number | boolean>>
}): void {
  const preset = workflowPreset(input.presetId)
  if (input.formulaName !== preset.formulaName || input.launchMode !== preset.launchMode) {
    throw new Error('workflow_preset_launch_mismatch')
  }
  for (const required of [
    'task_id',
    'run_id',
    'request',
    'capsule_path',
    'evidence_path',
    'verification_script',
  ]) {
    if (typeof input.variables[required] !== 'string' || input.variables[required].length === 0) {
      throw new Error(`workflow_variable_required:${required}`)
    }
  }
  if (preset.id === 'standard-build') {
    if (
      input.variables['interaction_mode'] !== preset.capabilities.interactionMode ||
      input.variables['drain_policy'] !== preset.capabilities.drainPolicy ||
      input.variables['push'] !== false ||
      input.variables['open_pr'] !== false ||
      typeof input.variables['max_iterations'] !== 'number' ||
      input.variables['max_iterations'] > preset.capabilities.maxCorrectionAttempts
    ) {
      throw new Error('workflow_capability_policy_rejected')
    }
  }
}

export function resolveWorkflowPreset(input: {
  blueprintId: ProjectBlueprintId
  projectDefaultWorkflowPresetId: WorkflowPresetId
  taskWorkflowPresetId: WorkflowPresetId | null
  taskSelectionSource: WorkflowSelectionSource
  taskLockedByUser: boolean
}): {
  preset: WorkflowPresetDefinition
  source: WorkflowSelectionSource
  lockedByUser: boolean
} {
  assertWorkflowPresetAllowed(input.blueprintId, input.projectDefaultWorkflowPresetId)
  if (input.taskWorkflowPresetId) {
    assertWorkflowPresetAllowed(input.blueprintId, input.taskWorkflowPresetId)
    return {
      preset: workflowPreset(input.taskWorkflowPresetId),
      source: input.taskSelectionSource,
      lockedByUser: input.taskLockedByUser,
    }
  }
  return {
    preset: workflowPreset(input.projectDefaultWorkflowPresetId),
    source: 'project_default',
    lockedByUser: false,
  }
}

export interface SoftwareProjectTemplate {
  readonly id: 'software-project'
  readonly version: number
  readonly factory: FactorySettings
  readonly workerTypes: readonly WorkerTypeDefinition[]
}

export const SOFTWARE_PROJECT_TEMPLATE: SoftwareProjectTemplate = {
  id: 'software-project',
  version: 2,
  factory: { maxParallelImplementationWorkers: 1 },
  workerTypes: [
    {
      kind: 'project_manager',
      displayName: 'Project Manager',
      promptOverride: null,
      defaultFormula: 'queue-reconcile',
      capacity: 1,
      modelBindings: [
        { slot: 'chat', provider: null, model: null },
        { slot: 'planning', provider: null, model: null },
      ],
      allowedTools: [
        'tasks.get',
        'tasks.search',
        'tasks.create',
        'tasks.update',
        'tasks.move',
        'tasks.queue',
        'tasks.propose_merge',
        'tasks.resolve',
        'tasks.set_dependencies',
        'tasks.split',
        'tasks.set_resource_intents',
        'tasks.append_evidence',
        'memory.read',
        'memory.propose',
        'memory.search',
        'memory.propose_update',
        'runs.inspect',
        'capacity.inspect',
      ],
      memoryPolicy: 'provenance_required',
    },
    {
      kind: 'software_engineer',
      displayName: 'Software Engineer',
      promptOverride: null,
      defaultFormula: 'software-delivery',
      capacity: 1,
      modelBindings: [
        { slot: 'design', provider: null, model: null },
        { slot: 'implementation', provider: null, model: null },
        { slot: 'review', provider: null, model: null },
      ],
      allowedTools: [
        'tasks.get',
        'memory.read',
        'memory.search',
        'memory.propose_update',
        'runs.inspect',
        'runs.context',
        'runs.report_evidence',
        'runs.report_review',
      ],
      memoryPolicy: 'provenance_required',
    },
  ],
}

export function softwareProjectTemplateForBlueprint(
  blueprintId: ProjectBlueprintId,
): SoftwareProjectTemplate {
  const blueprint = projectBlueprint(blueprintId)
  return {
    ...SOFTWARE_PROJECT_TEMPLATE,
    workerTypes: SOFTWARE_PROJECT_TEMPLATE.workerTypes.map((worker) =>
      worker.kind === 'software_engineer'
        ? {
            ...worker,
            defaultFormula: workflowPreset(blueprint.defaultWorkflowPresetId).formulaName,
          }
        : worker,
    ),
  }
}

export function isModelSlotForWorker(kind: WorkerTypeKind, slot: string): slot is ModelSlot {
  return (MODEL_SLOTS[kind] as readonly string[]).includes(slot)
}

export function validateWorkerType(definition: WorkerTypeDefinition): void {
  if (!Number.isInteger(definition.capacity) || definition.capacity !== 1) {
    throw new Error('Milestones 3 and 4 require worker capacity to remain one')
  }
  const expected = new Set(MODEL_SLOTS[definition.kind])
  const actual = new Set(definition.modelBindings.map((binding) => binding.slot))
  if (expected.size !== actual.size || [...expected].some((slot) => !actual.has(slot))) {
    throw new Error(`Invalid model slots for ${definition.kind}`)
  }
  if (definition.memoryPolicy !== 'provenance_required') {
    throw new Error('Durable memory must require provenance')
  }
}

export const TASK_STATUSES = ['backlog', 'queue', 'in_progress', 'needs_you'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const QUEUE_PHASES = [
  'awaiting_triage',
  'triaging',
  'ready',
  'waiting_dependency',
  'waiting_capacity',
] as const
export type QueuePhase = (typeof QUEUE_PHASES)[number]

export const TASK_RESOLUTIONS = ['accepted', 'rejected', 'cancelled', 'superseded'] as const
export type TaskResolution = (typeof TASK_RESOLUTIONS)[number]

export const NEEDS_YOU_ACTIONS = [
  'clarify',
  'approve',
  'review',
  'resolve_conflict',
  'recover_failure',
] as const
export type NeedsYouAction = (typeof NEEDS_YOU_ACTIONS)[number]

export interface TaskState {
  readonly status: TaskStatus
  readonly queuePhase: QueuePhase | null
  readonly needsYouAction: NeedsYouAction | null
  readonly needsYouMessage: string | null
  readonly resolution: TaskResolution | null
}

export function validateTaskState(task: TaskState): void {
  if ((task.status === 'queue') !== (task.queuePhase !== null)) {
    throw new Error('Only Queue tasks have a Queue phase')
  }
  const requestsUser = task.needsYouAction !== null || task.needsYouMessage !== null
  if ((task.status === 'needs_you') !== requestsUser) {
    throw new Error('Needs you tasks require an exact user action and message')
  }
  if (
    task.status === 'needs_you' &&
    (task.needsYouAction === null || !task.needsYouMessage?.trim())
  ) {
    throw new Error('Needs you tasks require an exact user action and message')
  }
}

export function queuePhaseForStatus(status: TaskStatus): QueuePhase | null {
  return status === 'queue' ? 'awaiting_triage' : null
}

export function taskCandidateScore(query: string, candidate: string): number {
  const tokens = (value: string) =>
    new Set(
      value
        .normalize('NFKD')
        .toLocaleLowerCase('en-US')
        .split(/[^a-z0-9]+/u)
        .filter((token) => token.length > 1),
    )
  const left = tokens(query)
  const right = tokens(candidate)
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  return (2 * intersection) / (left.size + right.size)
}
