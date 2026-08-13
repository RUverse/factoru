import type { FactoruDatabase, TaskRecord } from '@factoru/database'
import {
  taskCandidateSchema,
  taskMergeProposalSchema,
  taskSchema,
  type Task,
  type TaskCandidate,
  type TaskMergeProposal,
  taskEvidenceSchema,
  taskResourceIntentSchema,
  memoryProposalSchema,
  runDetailSchema,
  type TaskEvidence,
  type TaskResourceIntent,
  type MemoryProposal,
  type RunDetail,
} from '@factoru/protocol'
import { ApplicationError } from './project-service.js'

export function taskProjection(record: TaskRecord): Task {
  return taskSchema.parse({
    id: record.id,
    projectId: record.projectId,
    title: record.title,
    description: record.description,
    status: record.status,
    queuePhase: record.queuePhase,
    priority: record.priority,
    queueOrder: record.queueOrder,
    workerTypeKind: record.workerTypeKind,
    formulaName: record.formulaName,
    workflowPresetId: record.workflowPresetId,
    workflowSelectionSource: record.workflowSelectionSource,
    workflowLockedByUser: record.workflowLockedByUser,
    needsYouAction: record.needsYouAction,
    needsYouMessage: record.needsYouMessage,
    resolution: record.resolution,
    resolutionSummary: record.resolutionSummary,
    resolvedAt: record.resolvedAt,
    mergedIntoTaskId: record.mergedIntoTaskId,
    source: record.source,
    dependencyIds: record.dependencyIds,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

export class TaskService {
  readonly #database: FactoruDatabase

  constructor(database: FactoruDatabase) {
    this.#database = database
  }

  create(
    input: { projectId: string; title: string; description?: string; status: 'backlog' | 'queue' },
    actorId: string,
  ): Task {
    this.#requireProject(input.projectId)
    return taskProjection(
      this.#database.tasks.create({
        ...input,
        source: 'user',
        actorKind: 'user',
        actorId,
      }),
    )
  }

  update(
    input: {
      projectId: string
      taskId: string
      title?: string
      description?: string
      priority?: number
      workflowPresetId?: Task['workflowPresetId']
    },
    actorId: string,
  ): Task {
    this.#requireTask(input.projectId, input.taskId)
    return taskProjection(
      this.#database.tasks.update({
        ...input,
        workflowSelectionSource: input.workflowPresetId === undefined ? undefined : 'user',
        workflowLockedByUser:
          input.workflowPresetId === undefined ? undefined : input.workflowPresetId !== null,
        actorKind: 'user',
        actorId,
      }),
    )
  }

  move(
    input: {
      projectId: string
      taskId: string
      status: Task['status']
      needsYouAction?: NonNullable<Task['needsYouAction']>
      needsYouMessage?: string
    },
    actorId: string,
  ): Task {
    this.#requireTask(input.projectId, input.taskId)
    try {
      return taskProjection(
        this.#database.tasks.move({
          ...input,
          actorKind: 'user',
          actorId,
        }),
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'execution_wip_limit_reached') {
        throw new ApplicationError(
          'invalid_request',
          'Execution WIP is full; move the current task out of In progress first',
        )
      }
      throw error
    }
  }

  resolve(
    input: {
      projectId: string
      taskId: string
      resolution: NonNullable<Task['resolution']>
      summary: string
      mergedIntoTaskId?: string
    },
    actorId: string,
  ): Task {
    this.#requireTask(input.projectId, input.taskId)
    if (input.mergedIntoTaskId) this.#requireTask(input.projectId, input.mergedIntoTaskId)
    return taskProjection(
      this.#database.tasks.resolve({
        ...input,
        actorKind: 'user',
        actorId,
      }),
    )
  }

  search(projectId: string, query: string, limit: number): TaskCandidate[] {
    this.#requireProject(projectId)
    return taskCandidateSchema
      .array()
      .parse(this.#database.tasks.searchCandidates(projectId, query, limit))
  }

  decideMerge(
    input: { projectId: string; proposalId: string; decision: 'accept' | 'reject' },
    actorId: string,
  ): TaskMergeProposal {
    this.#requireProject(input.projectId)
    try {
      return taskMergeProposalSchema.parse(this.#database.tasks.decideMerge({ ...input, actorId }))
    } catch (error) {
      if (error instanceof Error && error.message === 'task_merge_proposal_not_found') {
        throw new ApplicationError('not_found', 'Pending merge proposal not found')
      }
      throw error
    }
  }

  split(
    input: {
      projectId: string
      taskId: string
      reason: string
      children: Array<{
        title: string
        description: string
        resourceIntents: Array<{
          kind: TaskResourceIntent['kind']
          name: string
          access: TaskResourceIntent['access']
        }>
      }>
    },
    actorId: string,
  ): { parent: Task; children: Task[] } {
    this.#requireTask(input.projectId, input.taskId)
    const result = this.#database.orchestration.splitTask({
      ...input,
      actorKind: 'user',
      actorId,
    })
    return { parent: taskProjection(result.parent), children: result.children.map(taskProjection) }
  }

  addEvidence(input: {
    projectId: string
    taskId: string
    kind: TaskEvidence['kind']
    summary: string
    provenance: TaskEvidence['provenance']
  }): TaskEvidence {
    this.#requireTask(input.projectId, input.taskId)
    return taskEvidenceSchema.parse(
      this.#database.orchestration.addEvidence(input.projectId, input.taskId, input),
    )
  }

  setResourceIntents(input: {
    projectId: string
    taskId: string
    intents: Array<{
      kind: TaskResourceIntent['kind']
      name: string
      access: TaskResourceIntent['access']
    }>
  }): TaskResourceIntent[] {
    this.#requireTask(input.projectId, input.taskId)
    return taskResourceIntentSchema
      .array()
      .parse(
        this.#database.orchestration.setResourceIntents(
          input.projectId,
          input.taskId,
          input.intents,
        ),
      )
  }

  proposeMemory(
    input: {
      projectId: string
      scope: 'project' | 'worker_type'
      workerTypeKind?: 'project_manager' | 'software_engineer'
      content: string
      provenance: { kind: string; ref: string }
    },
    actorId: string,
  ): MemoryProposal {
    this.#requireProject(input.projectId)
    return memoryProposalSchema.parse(
      this.#database.orchestration.proposeMemory({
        projectId: input.projectId,
        scope: input.scope,
        workerTypeKind: input.workerTypeKind,
        content: input.content,
        provenanceKind: input.provenance.kind,
        provenanceRef: input.provenance.ref,
        proposedBy: actorId,
      }),
    )
  }

  decideMemory(
    projectId: string,
    proposalId: string,
    decision: 'accept' | 'reject',
  ): MemoryProposal {
    this.#requireProject(projectId)
    return memoryProposalSchema.parse(
      this.#database.orchestration.decideMemory(projectId, proposalId, decision),
    )
  }

  searchMemory(
    projectId: string,
    query: string,
    workerTypeKind?: 'project_manager' | 'software_engineer',
    limit = 8,
  ) {
    this.#requireProject(projectId)
    return this.#database.orchestration.searchMemory(projectId, query, workerTypeKind, limit)
  }

  runDetail(projectId: string, runId: string): RunDetail {
    const run = this.#database.tasks.getExecutionRun(runId)
    if (!run || run.projectId !== projectId)
      throw new ApplicationError('not_found', 'Run not found')
    return runDetailSchema.parse(this.#database.orchestration.getRunDetail(runId))
  }

  #requireProject(projectId: string): void {
    if (!this.#database.getProject(projectId))
      throw new ApplicationError('not_found', 'Project not found')
  }

  #requireTask(projectId: string, taskId: string): void {
    this.#requireProject(projectId)
    const task = this.#database.tasks.get(taskId)
    if (!task || task.projectId !== projectId)
      throw new ApplicationError('not_found', 'Task not found')
  }
}
