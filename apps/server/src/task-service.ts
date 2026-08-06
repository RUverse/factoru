import type { FactoruDatabase, TaskRecord } from '@factoru/database'
import {
  taskCandidateSchema,
  taskMergeProposalSchema,
  taskSchema,
  type Task,
  type TaskCandidate,
  type TaskMergeProposal,
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
    },
    actorId: string,
  ): Task {
    this.#requireTask(input.projectId, input.taskId)
    return taskProjection(
      this.#database.tasks.update({
        ...input,
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
