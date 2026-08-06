export const WORKER_TYPE_KINDS = ['project_manager', 'software_engineer'] as const
export type WorkerTypeKind = (typeof WORKER_TYPE_KINDS)[number]

export const MODEL_SLOTS = {
  project_manager: ['chat', 'planning'],
  software_engineer: ['implementation', 'review'],
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

export interface SoftwareProjectTemplate {
  readonly id: 'software-project'
  readonly version: number
  readonly factory: FactorySettings
  readonly workerTypes: readonly WorkerTypeDefinition[]
}

export const SOFTWARE_PROJECT_TEMPLATE: SoftwareProjectTemplate = {
  id: 'software-project',
  version: 1,
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
        'tasks.search',
        'tasks.create',
        'tasks.update',
        'tasks.move',
        'tasks.propose_merge',
        'tasks.resolve',
        'memory.read',
        'memory.propose',
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
        { slot: 'implementation', provider: null, model: null },
        { slot: 'review', provider: null, model: null },
      ],
      allowedTools: ['tasks.get', 'memory.read', 'runs.report_evidence'],
      memoryPolicy: 'provenance_required',
    },
  ],
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
