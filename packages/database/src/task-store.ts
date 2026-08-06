import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  queuePhaseForStatus,
  taskCandidateScore,
  validateTaskState,
  type NeedsYouAction,
  type QueuePhase,
  type TaskResolution,
  type TaskStatus,
  type WorkerTypeKind,
} from '@factoru/domain'

export type TaskActorKind = 'user' | 'pm_chat' | 'pm_planner' | 'system'
export type TaskSource = 'user' | 'pm_chat' | 'pm_planner'

export interface TaskRecord {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  queuePhase: QueuePhase | null
  priority: number
  queueOrder: number
  workerTypeKind: WorkerTypeKind | null
  formulaName: string | null
  needsYouAction: NeedsYouAction | null
  needsYouMessage: string | null
  resolution: TaskResolution | null
  resolutionSummary: string | null
  resolvedAt: string | null
  mergedIntoTaskId: string | null
  source: TaskSource
  dependencyIds: string[]
  version: number
  createdAt: string
  updatedAt: string
}

export interface QueueReconciliationRecord {
  id: string
  projectId: string
  requestedRevision: number
  coalescedThroughRevision: number
  status: 'pending' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
  runId: string | null
  workflowRootBeadId: string | null
  formulaHash: string | null
  errorCode: string | null
  errorMessage: string | null
  requestedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface TaskCandidate {
  task: TaskRecord
  score: number
  match: 'likely' | 'possible'
}

interface TaskRow {
  id: string
  project_id: string
  title: string
  description: string
  status: TaskStatus
  queue_phase: QueuePhase | null
  priority: number
  queue_order: number
  worker_type_kind: WorkerTypeKind | null
  formula_name: string | null
  needs_you_action: NeedsYouAction | null
  needs_you_message: string | null
  resolution: TaskResolution | null
  resolution_summary: string | null
  resolved_at: string | null
  merged_into_task_id: string | null
  source: TaskSource
  version: number
  created_at: string
  updated_at: string
}

interface ReconciliationRow {
  id: string
  project_id: string
  requested_revision: number
  coalesced_through_revision: number
  status: QueueReconciliationRecord['status']
  run_id: string | null
  workflow_root_bead_id: string | null
  formula_hash: string | null
  error_code: string | null
  error_message: string | null
  requested_at: string
  started_at: string | null
  finished_at: string | null
}

function reconciliationFromRow(row: ReconciliationRow): QueueReconciliationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    requestedRevision: row.requested_revision,
    coalescedThroughRevision: row.coalesced_through_revision,
    status: row.status,
    runId: row.run_id,
    workflowRootBeadId: row.workflow_root_bead_id,
    formulaHash: row.formula_hash,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

export class TaskStore {
  readonly #db: Database.Database
  readonly #now: () => Date

  constructor(db: Database.Database, now: () => Date = () => new Date()) {
    this.#db = db
    this.#now = now
  }

  create(input: {
    projectId: string
    title: string
    description?: string
    status?: 'backlog' | 'queue'
    source: TaskSource
    actorKind: TaskActorKind
    actorId: string
  }): TaskRecord {
    const title = input.title.trim()
    const description = input.description?.trim() ?? ''
    if (!title) throw new Error('task_title_required')
    const status = input.status ?? 'backlog'
    const now = this.#now().toISOString()
    const id = `task_${randomUUID().replaceAll('-', '')}`
    return this.#db.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO tasks(
             id, project_id, title, description, status, queue_phase, source, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          title,
          description,
          status,
          queuePhaseForStatus(status),
          input.source,
          now,
          now,
        )
      const task = this.#require(id)
      this.#recordTaskEvent(task, 'created', input.actorKind, input.actorId, { status })
      if (status === 'queue') this.#requestReconciliation(input.projectId, 'task_created_in_queue')
      return this.#require(id)
    })()
  }

  get(id: string): TaskRecord | null {
    const row = this.#db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row ? this.#fromRow(row) : null
  }

  listActive(projectId: string): TaskRecord[] {
    return (
      this.#db
        .prepare(
          `SELECT * FROM tasks WHERE project_id = ? AND resolution IS NULL
           ORDER BY CASE status
             WHEN 'backlog' THEN 1 WHEN 'queue' THEN 2 WHEN 'in_progress' THEN 3 ELSE 4 END,
             priority DESC, queue_order, created_at`,
        )
        .all(projectId) as TaskRow[]
    ).map((row) => this.#fromRow(row))
  }

  listRecentResolved(projectId: string, limit = 50): TaskRecord[] {
    return (
      this.#db
        .prepare(
          `SELECT * FROM tasks WHERE project_id = ? AND resolution IS NOT NULL
           ORDER BY resolved_at DESC LIMIT ?`,
        )
        .all(projectId, limit) as TaskRow[]
    ).map((row) => this.#fromRow(row))
  }

  update(input: {
    taskId: string
    title?: string
    description?: string
    priority?: number
    queuePhase?: QueuePhase
    workerTypeKind?: WorkerTypeKind | null
    formulaName?: string | null
    needsYouAction?: NeedsYouAction
    needsYouMessage?: string
    actorKind: TaskActorKind
    actorId: string
  }): TaskRecord {
    return this.#db.transaction(() => {
      const current = this.#requireActive(input.taskId)
      const title = input.title === undefined ? current.title : input.title.trim()
      const description =
        input.description === undefined ? current.description : input.description.trim()
      if (!title) throw new Error('task_title_required')
      const priority = input.priority ?? current.priority
      if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
        throw new Error('invalid_task_priority')
      }
      const queuePhase =
        current.status === 'queue' ? (input.queuePhase ?? current.queuePhase) : null
      const needsYouAction =
        current.status === 'needs_you' ? (input.needsYouAction ?? current.needsYouAction) : null
      const needsYouMessage =
        current.status === 'needs_you'
          ? (input.needsYouMessage?.trim() ?? current.needsYouMessage)
          : null
      validateTaskState({
        status: current.status,
        queuePhase,
        needsYouAction,
        needsYouMessage,
        resolution: null,
      })
      const now = this.#now().toISOString()
      this.#db
        .prepare(
          `UPDATE tasks SET title = ?, description = ?, priority = ?, queue_phase = ?,
             worker_type_kind = ?, formula_name = ?, needs_you_action = ?, needs_you_message = ?,
             version = version + 1, updated_at = ? WHERE id = ? AND resolution IS NULL`,
        )
        .run(
          title,
          description,
          priority,
          queuePhase,
          input.workerTypeKind === undefined ? current.workerTypeKind : input.workerTypeKind,
          input.formulaName === undefined ? current.formulaName : input.formulaName?.trim() || null,
          needsYouAction,
          needsYouMessage,
          now,
          current.id,
        )
      const task = this.#require(current.id)
      this.#recordTaskEvent(task, 'updated', input.actorKind, input.actorId, {})
      if (task.status === 'queue')
        this.#requestReconciliation(task.projectId, 'queued_task_updated')
      return this.#require(current.id)
    })()
  }

  move(input: {
    taskId: string
    status: TaskStatus
    needsYouAction?: NeedsYouAction
    needsYouMessage?: string
    actorKind: TaskActorKind
    actorId: string
  }): TaskRecord {
    return this.#db.transaction(() => {
      const current = this.#requireActive(input.taskId)
      const queuePhase = queuePhaseForStatus(input.status)
      const needsYouAction = input.status === 'needs_you' ? (input.needsYouAction ?? null) : null
      const needsYouMessage =
        input.status === 'needs_you' ? (input.needsYouMessage?.trim() ?? null) : null
      validateTaskState({
        status: input.status,
        queuePhase,
        needsYouAction,
        needsYouMessage,
        resolution: null,
      })
      const now = this.#now().toISOString()
      this.#db
        .prepare(
          `UPDATE tasks SET status = ?, queue_phase = ?, needs_you_action = ?,
             needs_you_message = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(input.status, queuePhase, needsYouAction, needsYouMessage, now, current.id)
      const task = this.#require(current.id)
      this.#recordTaskEvent(task, 'moved', input.actorKind, input.actorId, {
        from: current.status,
        to: input.status,
      })
      if (current.status === 'queue' || task.status === 'queue') {
        this.#requestReconciliation(task.projectId, 'task_queue_transition')
      }
      return this.#require(current.id)
    })()
  }

  setDependencies(input: {
    taskId: string
    dependencyIds: readonly string[]
    actorKind: TaskActorKind
    actorId: string
  }): TaskRecord {
    return this.#db.transaction(() => {
      const task = this.#requireActive(input.taskId)
      const dependencyIds = [...new Set(input.dependencyIds)]
      if (dependencyIds.includes(task.id)) throw new Error('task_cannot_depend_on_itself')
      for (const id of dependencyIds) {
        const dependency = this.#requireActive(id)
        if (dependency.projectId !== task.projectId) throw new Error('cross_project_dependency')
      }
      this.#db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(task.id)
      const now = this.#now().toISOString()
      for (const id of dependencyIds) {
        this.#db
          .prepare(
            `INSERT INTO task_dependencies(project_id, task_id, needs_task_id, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(task.projectId, task.id, id, now)
      }
      this.#db
        .prepare('UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ?')
        .run(now, task.id)
      const updated = this.#require(task.id)
      this.#recordTaskEvent(updated, 'dependencies_updated', input.actorKind, input.actorId, {
        dependencyIds,
      })
      if (updated.status === 'queue') {
        this.#requestReconciliation(updated.projectId, 'queued_task_dependencies_updated')
      }
      return this.#require(task.id)
    })()
  }

  resolve(input: {
    taskId: string
    resolution: TaskResolution
    summary: string
    mergedIntoTaskId?: string
    actorKind: TaskActorKind
    actorId: string
  }): TaskRecord {
    return this.#db.transaction(() => {
      const task = this.#requireActive(input.taskId)
      const summary = input.summary.trim()
      if (!summary) throw new Error('task_resolution_summary_required')
      const mergedInto = input.mergedIntoTaskId ?? null
      if ((input.resolution === 'superseded') !== (mergedInto !== null)) {
        throw new Error('superseded_task_requires_merge_target')
      }
      if (mergedInto) {
        const target = this.#requireActive(mergedInto)
        if (target.projectId !== task.projectId || target.id === task.id) {
          throw new Error('invalid_task_merge_target')
        }
      }
      const now = this.#now().toISOString()
      this.#db
        .prepare(
          `UPDATE tasks SET resolution = ?, resolution_summary = ?, resolved_at = ?,
             merged_into_task_id = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(input.resolution, summary, now, mergedInto, now, task.id)
      const resolved = this.#require(task.id)
      this.#recordTaskEvent(resolved, 'resolved', input.actorKind, input.actorId, {
        resolution: input.resolution,
        mergedIntoTaskId: mergedInto,
      })
      if (task.status === 'queue') {
        this.#requestReconciliation(task.projectId, 'queued_task_resolved')
      }
      return this.#require(task.id)
    })()
  }

  searchCandidates(projectId: string, query: string, limit = 8): TaskCandidate[] {
    const normalized = query.trim()
    if (!normalized) return []
    return [...this.listActive(projectId), ...this.listRecentResolved(projectId, 30)]
      .map((task) => ({
        task,
        score: taskCandidateScore(normalized, `${task.title} ${task.description}`),
      }))
      .filter((candidate) => candidate.score >= 0.2)
      .sort(
        (left, right) =>
          right.score - left.score || right.task.updatedAt.localeCompare(left.task.updatedAt),
      )
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map((candidate) => ({
        ...candidate,
        match: candidate.score >= 0.7 ? 'likely' : 'possible',
      }))
  }

  queueRevision(projectId: string): number {
    const row = this.#db
      .prepare('SELECT queue_revision FROM factory_settings WHERE project_id = ?')
      .get(projectId) as { queue_revision: number } | undefined
    if (!row) throw new Error('project_product_state_not_found')
    return row.queue_revision
  }

  pendingReconciliation(projectId: string): QueueReconciliationRecord | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM queue_reconciliations WHERE project_id = ? AND status = 'pending'
         ORDER BY requested_at LIMIT 1`,
      )
      .get(projectId) as ReconciliationRow | undefined
    return row ? reconciliationFromRow(row) : null
  }

  activeReconciliation(projectId: string): QueueReconciliationRecord | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM queue_reconciliations WHERE project_id = ?
         AND status IN ('running', 'cancelling') ORDER BY requested_at LIMIT 1`,
      )
      .get(projectId) as ReconciliationRow | undefined
    return row ? reconciliationFromRow(row) : null
  }

  latestReconciliation(projectId: string): QueueReconciliationRecord | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM queue_reconciliations WHERE project_id = ?
         ORDER BY requested_at DESC LIMIT 1`,
      )
      .get(projectId) as ReconciliationRow | undefined
    return row ? reconciliationFromRow(row) : null
  }

  claimNextReconciliation(): QueueReconciliationRecord | null {
    const row = this.#db
      .prepare(
        `SELECT q.* FROM queue_reconciliations q
         WHERE q.status = 'pending' AND NOT EXISTS (
           SELECT 1 FROM queue_reconciliations active
           WHERE active.project_id = q.project_id AND active.status IN ('running', 'cancelling')
         ) ORDER BY q.requested_at LIMIT 1`,
      )
      .get() as ReconciliationRow | undefined
    return row ? reconciliationFromRow(row) : null
  }

  startReconciliation(
    id: string,
    correlation: { runId: string; workflowRootBeadId: string; formulaHash?: string },
  ): QueueReconciliationRecord {
    return this.#db.transaction(() => {
      const now = this.#now().toISOString()
      const updated = this.#db
        .prepare(
          `UPDATE queue_reconciliations SET status = 'running', run_id = ?,
             workflow_root_bead_id = ?, formula_hash = ?, started_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(
          correlation.runId,
          correlation.workflowRootBeadId,
          correlation.formulaHash ?? null,
          now,
          id,
        )
      if (updated.changes !== 1) throw new Error('invalid_queue_reconciliation_state')
      const result = this.#reconciliation(id)
      this.#appendProductEvent('queue.reconciliation_started', result.projectId, {
        reconciliationId: id,
        runId: correlation.runId,
      })
      return result
    })()
  }

  finishReconciliation(
    id: string,
    status: 'completed' | 'failed' | 'cancelled',
    error?: { code: string; message: string },
  ): QueueReconciliationRecord {
    return this.#db.transaction(() => {
      const now = this.#now().toISOString()
      const updated = this.#db
        .prepare(
          `UPDATE queue_reconciliations SET status = ?, error_code = ?, error_message = ?,
             finished_at = ? WHERE id = ? AND status IN ('pending', 'running', 'cancelling')`,
        )
        .run(status, error?.code ?? null, error?.message ?? null, now, id)
      if (updated.changes !== 1) throw new Error('invalid_queue_reconciliation_state')
      const result = this.#reconciliation(id)
      this.#appendProductEvent('queue.reconciliation_finished', result.projectId, {
        reconciliationId: id,
        status,
        errorCode: error?.code ?? null,
      })
      return result
    })()
  }

  #requestReconciliation(projectId: string, reason: string): QueueReconciliationRecord {
    const now = this.#now().toISOString()
    this.#db
      .prepare(
        `UPDATE factory_settings SET queue_revision = queue_revision + 1, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(now, projectId)
    const revision = this.queueRevision(projectId)
    const pending = this.pendingReconciliation(projectId)
    if (pending) {
      this.#db
        .prepare(`UPDATE queue_reconciliations SET coalesced_through_revision = ? WHERE id = ?`)
        .run(revision, pending.id)
      this.#appendProductEvent('queue.reconciliation_coalesced', projectId, {
        reconciliationId: pending.id,
        revision,
        reason,
      })
      return this.#reconciliation(pending.id)
    }
    const id = `recon_${randomUUID().replaceAll('-', '')}`
    this.#db
      .prepare(
        `INSERT INTO queue_reconciliations(
           id, project_id, requested_revision, coalesced_through_revision, status, requested_at
         ) VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, projectId, revision, revision, now)
    this.#db
      .prepare(
        `INSERT INTO outbox_items(
           id, kind, aggregate_id, payload_json, status, available_at, created_at, updated_at
         ) VALUES (?, 'queue.reconcile', ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(randomUUID(), id, JSON.stringify({ projectId, reconciliationId: id }), now, now, now)
    this.#appendProductEvent('queue.reconciliation_requested', projectId, {
      reconciliationId: id,
      revision,
      reason,
    })
    return this.#reconciliation(id)
  }

  #fromRow(row: TaskRow): TaskRecord {
    const dependencies = this.#db
      .prepare(
        'SELECT needs_task_id FROM task_dependencies WHERE task_id = ? ORDER BY needs_task_id',
      )
      .all(row.id) as Array<{ needs_task_id: string }>
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      queuePhase: row.queue_phase,
      priority: row.priority,
      queueOrder: row.queue_order,
      workerTypeKind: row.worker_type_kind,
      formulaName: row.formula_name,
      needsYouAction: row.needs_you_action,
      needsYouMessage: row.needs_you_message,
      resolution: row.resolution,
      resolutionSummary: row.resolution_summary,
      resolvedAt: row.resolved_at,
      mergedIntoTaskId: row.merged_into_task_id,
      source: row.source,
      dependencyIds: dependencies.map((dependency) => dependency.needs_task_id),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  #require(id: string): TaskRecord {
    const task = this.get(id)
    if (!task) throw new Error('task_not_found')
    return task
  }

  #requireActive(id: string): TaskRecord {
    const task = this.#require(id)
    if (task.resolution) throw new Error('task_already_resolved')
    return task
  }

  #reconciliation(id: string): QueueReconciliationRecord {
    const row = this.#db.prepare('SELECT * FROM queue_reconciliations WHERE id = ?').get(id) as
      ReconciliationRow | undefined
    if (!row) throw new Error('queue_reconciliation_not_found')
    return reconciliationFromRow(row)
  }

  #recordTaskEvent(
    task: TaskRecord,
    action: string,
    actorKind: TaskActorKind,
    actorId: string,
    data: unknown,
  ): void {
    const now = this.#now().toISOString()
    this.#db
      .prepare(
        `INSERT INTO task_events(
           event_id, project_id, task_id, task_version, action, actor_kind, actor_id,
           data_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        task.projectId,
        task.id,
        task.version,
        action,
        actorKind,
        actorId,
        JSON.stringify(data),
        now,
      )
    this.#appendProductEvent(`task.${action}`, task.projectId, {
      taskId: task.id,
      taskVersion: task.version,
      actorKind,
    })
  }

  #appendProductEvent(type: string, projectId: string, payload: unknown): void {
    this.#db
      .prepare(
        `INSERT INTO domain_events(
           event_id, type, aggregate_type, aggregate_id, aggregate_version,
           payload_json, occurred_at
         ) VALUES (?, ?, 'task', ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        type,
        projectId,
        this.queueRevision(projectId) + 1,
        JSON.stringify(payload),
        this.#now().toISOString(),
      )
  }
}
