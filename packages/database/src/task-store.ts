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

export type ExecutionStage =
  | 'admission'
  | 'capsule'
  | 'implementation'
  | 'checks'
  | 'review'
  | 'integration'
  | 'needs_you'
  | 'terminal'

export interface ExecutionStepRecord {
  id: string
  title: string
  status:
    | 'pending'
    | 'running'
    | 'blocked'
    | 'cancelling'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'skipped'
    | 'unknown'
}

export interface ExecutionUsageRecord {
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
}

export interface ExecutionReviewPackageRecord {
  request: string
  plan: string
  diff: string
  commits: string[]
  checks: { status: 'passed' | 'failed'; output: string }
  internalReview: string
  unresolvedRisks: string[]
  usage: ExecutionUsageRecord
  capsulePath: string
  branchName: string
}

export interface ExecutionRunRecord {
  id: string
  projectId: string
  taskId: string
  cityName: string
  rigName: string
  formulaName: string
  formulaVersion: string | null
  formulaHash: string | null
  runId: string | null
  workflowRootBeadId: string | null
  startingEventCursor: number
  requestId: string
  status: 'pending' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
  stage: ExecutionStage
  capsuleId: string | null
  capsulePath: string | null
  branchName: string | null
  baseBranch: string | null
  steps: ExecutionStepRecord[]
  logs: string[]
  usage: ExecutionUsageRecord
  reviewPackage: ExecutionReviewPackageRecord | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
  archivedAt: string | null
}

export interface TaskCandidate {
  task: TaskRecord
  score: number
  match: 'likely' | 'possible'
}

export interface TaskMergeProposalRecord {
  id: string
  projectId: string
  sourceTaskId: string
  targetTaskId: string
  reason: string
  status: 'pending' | 'accepted' | 'rejected'
  proposedBy: string
  createdAt: string
  decidedAt: string | null
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

interface ExecutionRunRow {
  id: string
  project_id: string
  task_id: string
  city_name: string
  rig_name: string
  formula_name: string
  formula_version: string | null
  formula_hash: string | null
  run_id: string | null
  workflow_root_bead_id: string | null
  starting_event_cursor: number
  request_id: string
  status: ExecutionRunRecord['status']
  stage: ExecutionStage
  capsule_id: string | null
  capsule_path: string | null
  branch_name: string | null
  base_branch: string | null
  steps_json: string
  logs_json: string
  usage_json: string
  review_package_json: string
  error_code: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string | null
  archived_at: string | null
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

function executionFromRow(row: ExecutionRunRow): ExecutionRunRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    cityName: row.city_name,
    rigName: row.rig_name,
    formulaName: row.formula_name,
    formulaVersion: row.formula_version,
    formulaHash: row.formula_hash,
    runId: row.run_id,
    workflowRootBeadId: row.workflow_root_bead_id,
    startingEventCursor: row.starting_event_cursor,
    requestId: row.request_id,
    status: row.status,
    stage: row.stage,
    capsuleId: row.capsule_id,
    capsulePath: row.capsule_path,
    branchName: row.branch_name,
    baseBranch: row.base_branch,
    steps: JSON.parse(row.steps_json) as ExecutionStepRecord[],
    logs: JSON.parse(row.logs_json) as string[],
    usage: JSON.parse(row.usage_json) as ExecutionUsageRecord,
    reviewPackage: JSON.parse(row.review_package_json) as ExecutionReviewPackageRecord | null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at ?? row.created_at,
    archivedAt: row.archived_at,
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
      if (input.status === 'in_progress' && current.status !== 'in_progress') {
        const running = this.#db
          .prepare(
            `SELECT COUNT(*) AS count FROM tasks
             WHERE project_id = ? AND status = 'in_progress' AND resolution IS NULL`,
          )
          .get(current.projectId) as { count: number }
        if (running.count >= 1) throw new Error('execution_wip_limit_reached')
      }
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
      this.#db
        .prepare(
          `UPDATE task_merge_proposals SET status = 'rejected', decided_at = ?
           WHERE status = 'pending' AND (source_task_id = ? OR target_task_id = ?)`,
        )
        .run(now, task.id, task.id)
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

  proposeMerge(input: {
    projectId: string
    sourceTaskId: string
    targetTaskId: string
    reason: string
    proposedBy: string
    actorKind: Extract<TaskActorKind, 'pm_chat' | 'pm_planner'>
  }): TaskMergeProposalRecord {
    return this.#db.transaction(() => {
      const source = this.#requireActive(input.sourceTaskId)
      const target = this.#requireActive(input.targetTaskId)
      if (
        source.projectId !== input.projectId ||
        target.projectId !== input.projectId ||
        source.id === target.id
      ) {
        throw new Error('invalid_task_merge_target')
      }
      const reason = input.reason.trim()
      if (!reason) throw new Error('task_merge_reason_required')
      const existing = this.#db
        .prepare(
          `SELECT * FROM task_merge_proposals WHERE source_task_id = ? AND target_task_id = ?
           AND status = 'pending'`,
        )
        .get(source.id, target.id) as
        | {
            id: string
            project_id: string
            source_task_id: string
            target_task_id: string
            reason: string
            status: TaskMergeProposalRecord['status']
            proposed_by: string
            created_at: string
            decided_at: string | null
          }
        | undefined
      if (existing) return this.#mergeProposal(existing)
      const id = `merge_${randomUUID().replaceAll('-', '')}`
      const now = this.#now().toISOString()
      this.#db
        .prepare(
          `INSERT INTO task_merge_proposals(
             id, project_id, source_task_id, target_task_id, reason, status, proposed_by, created_at
           ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(id, input.projectId, source.id, target.id, reason, input.proposedBy, now)
      this.#recordTaskEvent(source, 'merge_proposed', input.actorKind, input.proposedBy, {
        proposalId: id,
        targetTaskId: target.id,
        reason,
      })
      return this.listMergeProposals(input.projectId).find((proposal) => proposal.id === id)!
    })()
  }

  listMergeProposals(projectId: string): TaskMergeProposalRecord[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM task_merge_proposals WHERE project_id = ? AND status = 'pending'
         ORDER BY created_at`,
      )
      .all(projectId) as Array<{
      id: string
      project_id: string
      source_task_id: string
      target_task_id: string
      reason: string
      status: TaskMergeProposalRecord['status']
      proposed_by: string
      created_at: string
      decided_at: string | null
    }>
    return rows.map((row) => this.#mergeProposal(row))
  }

  decideMerge(input: {
    projectId: string
    proposalId: string
    decision: 'accept' | 'reject'
    actorId: string
  }): TaskMergeProposalRecord {
    return this.#db.transaction(() => {
      const row = this.#db
        .prepare('SELECT * FROM task_merge_proposals WHERE id = ? AND project_id = ?')
        .get(input.proposalId, input.projectId) as
        | {
            id: string
            project_id: string
            source_task_id: string
            target_task_id: string
            reason: string
            status: TaskMergeProposalRecord['status']
            proposed_by: string
            created_at: string
            decided_at: string | null
          }
        | undefined
      if (!row || row.status !== 'pending') throw new Error('task_merge_proposal_not_found')
      const now = this.#now().toISOString()
      if (input.decision === 'accept') {
        this.resolve({
          taskId: row.source_task_id,
          resolution: 'superseded',
          summary: `Merged after user confirmation: ${row.reason}`,
          mergedIntoTaskId: row.target_task_id,
          actorKind: 'user',
          actorId: input.actorId,
        })
      } else {
        const source = this.#requireActive(row.source_task_id)
        this.#recordTaskEvent(source, 'merge_rejected', 'user', input.actorId, {
          proposalId: row.id,
          targetTaskId: row.target_task_id,
        })
      }
      this.#db
        .prepare(`UPDATE task_merge_proposals SET status = ?, decided_at = ? WHERE id = ?`)
        .run(input.decision === 'accept' ? 'accepted' : 'rejected', now, row.id)
      return this.#mergeProposal({
        ...row,
        status: input.decision === 'accept' ? 'accepted' : 'rejected',
        decided_at: now,
      })
    })()
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

  claimNextReconciliation(): {
    outboxId: string
    attemptCount: number
    reconciliation: QueueReconciliationRecord
  } | null {
    return this.#db.transaction(() => {
      const now = this.#now()
      const row = this.#db
        .prepare(
          `SELECT q.*, o.id AS outbox_id, o.attempt_count FROM queue_reconciliations q
         JOIN outbox_items o ON o.aggregate_id = q.id AND o.kind = 'queue.reconcile'
         WHERE q.status = 'pending' AND o.status IN ('pending', 'processing')
         AND o.available_at <= ? AND (o.lease_expires_at IS NULL OR o.lease_expires_at <= ?)
         AND NOT EXISTS (
           SELECT 1 FROM queue_reconciliations active
           WHERE active.project_id = q.project_id AND active.status IN ('running', 'cancelling')
         ) ORDER BY q.requested_at LIMIT 1`,
        )
        .get(now.toISOString(), now.toISOString()) as
        (ReconciliationRow & { outbox_id: string; attempt_count: number }) | undefined
      if (!row) return null
      this.#db
        .prepare(
          `UPDATE outbox_items SET status = 'processing', attempt_count = attempt_count + 1,
             lease_expires_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(new Date(now.getTime() + 30_000).toISOString(), now.toISOString(), row.outbox_id)
      return {
        outboxId: row.outbox_id,
        attemptCount: row.attempt_count + 1,
        reconciliation: reconciliationFromRow(row),
      }
    })()
  }

  startReconciliation(
    id: string,
    correlation: { runId: string; workflowRootBeadId: string; formulaHash?: string },
    outboxId?: string,
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
      if (outboxId) {
        this.#db
          .prepare(
            `UPDATE outbox_items SET status = 'completed', lease_expires_at = NULL,
               updated_at = ? WHERE id = ?`,
          )
          .run(now, outboxId)
      }
      const result = this.#reconciliation(id)
      this.#appendProductEvent('queue.reconciliation_started', result.projectId, {
        reconciliationId: id,
        runId: correlation.runId,
      })
      return result
    })()
  }

  deferReconciliationDispatch(
    outboxId: string,
    reconciliationId: string,
    attemptCount: number,
    error: { code: string; message: string },
  ): void {
    const now = this.#now()
    if (attemptCount >= 6) {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `UPDATE outbox_items SET status = 'failed', lease_expires_at = NULL,
               last_error = ?, updated_at = ? WHERE id = ?`,
          )
          .run(error.message, now.toISOString(), outboxId)
        this.finishReconciliation(reconciliationId, 'failed', error)
      })()
      return
    }
    const delays = [1, 5, 30, 120, 600, 1_800]
    const availableAt = new Date(now.getTime() + delays[attemptCount - 1]! * 1_000).toISOString()
    this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE outbox_items SET status = 'pending', available_at = ?, lease_expires_at = NULL,
             last_error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(availableAt, error.message, now.toISOString(), outboxId)
      this.#db
        .prepare(
          `UPDATE queue_reconciliations SET error_code = ?, error_message = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(error.code, error.message, reconciliationId)
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

  listExecutionRuns(projectId: string, includeArchived = false): ExecutionRunRecord[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM task_runs WHERE project_id = ? AND kind = 'implementation'
         ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY created_at DESC LIMIT 100`,
      )
      .all(projectId) as ExecutionRunRow[]
    return rows.map(executionFromRow)
  }

  getExecutionRun(id: string): ExecutionRunRecord | null {
    const row = this.#db
      .prepare("SELECT * FROM task_runs WHERE id = ? AND kind = 'implementation'")
      .get(id) as ExecutionRunRow | undefined
    return row ? executionFromRow(row) : null
  }

  activeExecution(projectId: string): ExecutionRunRecord | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM task_runs WHERE project_id = ? AND kind = 'implementation'
         AND status IN ('pending', 'running', 'cancelling') ORDER BY created_at LIMIT 1`,
      )
      .get(projectId) as ExecutionRunRow | undefined
    return row ? executionFromRow(row) : null
  }

  admitNextExecution(input: { cityName: string; packVersion: string }): ExecutionRunRecord | null {
    return this.#db.transaction(() => {
      const candidate = this.#db
        .prepare(
          `SELECT t.*, r.rig_name FROM tasks t
           JOIN project_rig_bindings r ON r.project_id = t.project_id
           WHERE t.resolution IS NULL AND t.status = 'queue' AND t.queue_phase = 'ready'
             AND t.worker_type_kind = 'software_engineer' AND t.formula_name = 'software-delivery'
             AND r.registration_state = 'ready'
             AND NOT EXISTS (
               SELECT 1 FROM task_runs active WHERE active.project_id = t.project_id
                 AND active.kind = 'implementation'
                 AND active.status IN ('pending', 'running', 'cancelling')
             )
             AND NOT EXISTS (
               SELECT 1 FROM tasks review WHERE review.project_id = t.project_id
                 AND review.resolution IS NULL AND review.status = 'needs_you'
             )
             AND NOT EXISTS (
               SELECT 1 FROM task_dependencies d
               JOIN tasks dependency ON dependency.id = d.needs_task_id
               WHERE d.task_id = t.id
                 AND (dependency.resolution IS NULL OR dependency.resolution <> 'accepted')
             )
           ORDER BY t.priority DESC, t.queue_order, t.created_at LIMIT 1`,
        )
        .get() as (TaskRow & { rig_name: string }) | undefined
      if (!candidate) return null

      const now = this.#now().toISOString()
      const id = `run_${randomUUID().replaceAll('-', '')}`
      this.#db
        .prepare(
          `INSERT INTO task_runs(
             id, project_id, task_id, kind, city_name, rig_name, formula_name,
             formula_version, starting_event_cursor, request_id, status, stage,
             created_at, updated_at
           ) VALUES (?, ?, ?, 'implementation', ?, ?, 'software-delivery', ?, 0, ?,
             'pending', 'admission', ?, ?)`,
        )
        .run(
          id,
          candidate.project_id,
          candidate.id,
          input.cityName,
          candidate.rig_name,
          input.packVersion,
          id,
          now,
          now,
        )
      this.#db
        .prepare(
          `INSERT INTO outbox_items(
             id, kind, aggregate_id, payload_json, status, available_at, created_at, updated_at
           ) VALUES (?, 'execution.start', ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          JSON.stringify({ projectId: candidate.project_id, taskId: candidate.id, runId: id }),
          now,
          now,
          now,
        )
      this.#db
        .prepare(
          `UPDATE tasks SET status = 'in_progress', queue_phase = NULL,
             version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(now, candidate.id)
      this.#recordTaskEvent(this.#require(candidate.id), 'execution_admitted', 'system', id, {
        runId: id,
      })
      this.#appendProductEvent('task.execution_admitted', candidate.project_id, {
        taskId: candidate.id,
        runId: id,
      })
      return this.#execution(id)
    })()
  }

  claimExecutionDispatch(): {
    outboxId: string
    attemptCount: number
    run: ExecutionRunRecord
  } | null {
    return this.#db.transaction(() => {
      const now = this.#now()
      const row = this.#db
        .prepare(
          `SELECT r.*, o.id AS outbox_id, o.attempt_count FROM task_runs r
           JOIN outbox_items o ON o.aggregate_id = r.id AND o.kind = 'execution.start'
           WHERE r.kind = 'implementation' AND r.status = 'pending'
             AND o.status IN ('pending', 'processing') AND o.available_at <= ?
             AND (o.lease_expires_at IS NULL OR o.lease_expires_at <= ?)
           ORDER BY r.created_at LIMIT 1`,
        )
        .get(now.toISOString(), now.toISOString()) as
        (ExecutionRunRow & { outbox_id: string; attempt_count: number }) | undefined
      if (!row) return null
      this.#db
        .prepare(
          `UPDATE outbox_items SET status = 'processing', attempt_count = attempt_count + 1,
             lease_expires_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(new Date(now.getTime() + 60_000).toISOString(), now.toISOString(), row.outbox_id)
      return {
        outboxId: row.outbox_id,
        attemptCount: row.attempt_count + 1,
        run: executionFromRow(row),
      }
    })()
  }

  setExecutionCapsule(
    id: string,
    capsule: { id: string; path: string; branchName: string; baseBranch: string },
  ): ExecutionRunRecord {
    const now = this.#now().toISOString()
    const updated = this.#db
      .prepare(
        `UPDATE task_runs SET capsule_id = ?, capsule_path = ?, branch_name = ?,
           base_branch = ?, stage = 'capsule', updated_at = ?
         WHERE id = ? AND kind = 'implementation' AND status = 'pending'`,
      )
      .run(capsule.id, capsule.path, capsule.branchName, capsule.baseBranch, now, id)
    if (updated.changes !== 1) throw new Error('invalid_execution_state')
    return this.#execution(id)
  }

  startExecution(
    id: string,
    correlation: {
      runId: string
      workflowRootBeadId: string
      formulaHash?: string
      startingEventSeq: number
    },
    outboxId: string,
  ): ExecutionRunRecord {
    return this.#db.transaction(() => {
      const now = this.#now().toISOString()
      const updated = this.#db
        .prepare(
          `UPDATE task_runs SET status = 'running', stage = 'implementation', run_id = ?,
             workflow_root_bead_id = ?, formula_hash = ?, starting_event_cursor = ?,
             started_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
        )
        .run(
          correlation.runId,
          correlation.workflowRootBeadId,
          correlation.formulaHash ?? null,
          correlation.startingEventSeq,
          now,
          now,
          id,
        )
      if (updated.changes !== 1) throw new Error('invalid_execution_state')
      this.#db
        .prepare(
          `UPDATE outbox_items SET status = 'completed', lease_expires_at = NULL,
             updated_at = ? WHERE id = ?`,
        )
        .run(now, outboxId)
      const run = this.#execution(id)
      this.#appendProductEvent('task.execution_started', run.projectId, {
        taskId: run.taskId,
        runId: run.id,
      })
      return run
    })()
  }

  deferExecutionDispatch(
    outboxId: string,
    runId: string,
    attemptCount: number,
    error: { code: string; message: string },
  ): void {
    const now = this.#now()
    if (attemptCount >= 6) {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `UPDATE outbox_items SET status = 'failed', lease_expires_at = NULL,
               last_error = ?, updated_at = ? WHERE id = ?`,
          )
          .run(error.message, now.toISOString(), outboxId)
        this.finishExecution(runId, 'failed', { error })
      })()
      return
    }
    const delays = [1, 5, 30, 120, 600, 1_800]
    const availableAt = new Date(now.getTime() + delays[attemptCount - 1]! * 1_000).toISOString()
    this.#db
      .prepare(
        `UPDATE outbox_items SET status = 'pending', available_at = ?, lease_expires_at = NULL,
           last_error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(availableAt, error.message, now.toISOString(), outboxId)
    this.#db
      .prepare(
        `UPDATE task_runs SET error_code = ?, error_message = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(error.code, error.message, now.toISOString(), runId)
  }

  observeExecution(
    id: string,
    input: {
      stage: ExecutionStage
      steps: readonly ExecutionStepRecord[]
      logs?: readonly string[]
      usage?: ExecutionUsageRecord
    },
  ): ExecutionRunRecord {
    const now = this.#now().toISOString()
    this.#db
      .prepare(
        `UPDATE task_runs SET stage = ?, steps_json = ?, logs_json = COALESCE(?, logs_json),
           usage_json = COALESCE(?, usage_json),
           error_code = NULL, error_message = NULL, updated_at = ?
         WHERE id = ? AND status IN ('running', 'cancelling')`,
      )
      .run(
        input.stage,
        JSON.stringify(input.steps),
        input.logs ? JSON.stringify(input.logs) : null,
        input.usage ? JSON.stringify(input.usage) : null,
        now,
        id,
      )
    return this.#execution(id)
  }

  requestExecutionCancellation(id: string): ExecutionRunRecord {
    const now = this.#now().toISOString()
    const updated = this.#db
      .prepare(
        `UPDATE task_runs SET status = 'cancelling', updated_at = ?
         WHERE id = ? AND status IN ('pending', 'running')`,
      )
      .run(now, id)
    if (updated.changes !== 1) throw new Error('invalid_execution_state')
    return this.#execution(id)
  }

  finishExecution(
    id: string,
    status: 'completed' | 'failed' | 'cancelled',
    input: {
      reviewPackage?: ExecutionReviewPackageRecord
      usage?: ExecutionUsageRecord
      error?: { code: string; message: string }
      needsYouAction?: 'review' | 'resolve_conflict' | 'recover_failure'
    } = {},
  ): ExecutionRunRecord {
    return this.#db.transaction(() => {
      const current = this.#execution(id)
      const now = this.#now().toISOString()
      const stage: ExecutionStage = status === 'completed' ? 'needs_you' : 'terminal'
      const updated = this.#db
        .prepare(
          `UPDATE task_runs SET status = ?, stage = ?, review_package_json = ?,
             usage_json = COALESCE(?, usage_json), error_code = ?, error_message = ?,
             terminal_disposition = ?, finished_at = ?, updated_at = ?
           WHERE id = ? AND status IN ('pending', 'running', 'cancelling')`,
        )
        .run(
          status,
          stage,
          JSON.stringify(input.reviewPackage ?? null),
          input.usage ? JSON.stringify(input.usage) : null,
          input.error?.code ?? null,
          input.error?.message ?? null,
          status,
          now,
          now,
          id,
        )
      if (updated.changes !== 1) throw new Error('invalid_execution_state')

      if (status === 'completed') {
        this.move({
          taskId: current.taskId,
          status: 'needs_you',
          needsYouAction: 'review',
          needsYouMessage: 'Review the internally verified implementation package.',
          actorKind: 'system',
          actorId: id,
        })
      } else if (status === 'failed') {
        this.move({
          taskId: current.taskId,
          status: 'needs_you',
          needsYouAction: input.needsYouAction ?? 'recover_failure',
          needsYouMessage: input.error?.message ?? 'The implementation workflow failed.',
          actorKind: 'system',
          actorId: id,
        })
      } else {
        this.#db
          .prepare(
            `UPDATE outbox_items SET status = 'completed', lease_expires_at = NULL,
               updated_at = ? WHERE aggregate_id = ? AND kind = 'execution.start'
               AND status IN ('pending', 'processing')`,
          )
          .run(now, id)
        this.resolve({
          taskId: current.taskId,
          resolution: 'cancelled',
          summary: 'The implementation run was cancelled.',
          actorKind: 'system',
          actorId: id,
        })
      }
      this.#appendProductEvent('task.execution_finished', current.projectId, {
        taskId: current.taskId,
        runId: id,
        status,
      })
      return this.#execution(id)
    })()
  }

  archiveExecution(id: string): ExecutionRunRecord {
    const now = this.#now().toISOString()
    const updated = this.#db
      .prepare(
        `UPDATE task_runs SET archived_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('completed', 'failed', 'cancelled') AND archived_at IS NULL`,
      )
      .run(now, now, id)
    if (updated.changes !== 1) throw new Error('invalid_execution_state')
    return this.#execution(id)
  }

  requeueExecution(id: string, feedback?: string): TaskRecord {
    return this.#db.transaction(() => {
      const run = this.#execution(id)
      if (run.status !== 'completed' && run.status !== 'failed') {
        throw new Error('invalid_execution_state')
      }
      const task = this.#requireActive(run.taskId)
      if (task.status !== 'needs_you') throw new Error('invalid_task_state')
      const now = this.#now().toISOString()
      const description = feedback?.trim()
        ? `${task.description}\n\nUser review feedback:\n${feedback.trim()}`.trim()
        : task.description
      this.#db
        .prepare(
          `UPDATE tasks SET status = 'queue', queue_phase = 'ready', description = ?,
             needs_you_action = NULL, needs_you_message = NULL, version = version + 1,
             updated_at = ? WHERE id = ?`,
        )
        .run(description, now, task.id)
      const updated = this.#require(task.id)
      this.#recordTaskEvent(
        updated,
        feedback ? 'changes_requested' : 'execution_retry_requested',
        'user',
        id,
        {
          previousRunId: id,
        },
      )
      return updated
    })()
  }

  approveExecution(id: string, summary: string, actorId: string): TaskRecord {
    const run = this.#execution(id)
    if (run.status !== 'completed' || !run.reviewPackage) throw new Error('invalid_execution_state')
    return this.resolve({
      taskId: run.taskId,
      resolution: 'accepted',
      summary,
      actorKind: 'user',
      actorId,
    })
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

  #mergeProposal(row: {
    id: string
    project_id: string
    source_task_id: string
    target_task_id: string
    reason: string
    status: TaskMergeProposalRecord['status']
    proposed_by: string
    created_at: string
    decided_at: string | null
  }): TaskMergeProposalRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sourceTaskId: row.source_task_id,
      targetTaskId: row.target_task_id,
      reason: row.reason,
      status: row.status,
      proposedBy: row.proposed_by,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
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

  #execution(id: string): ExecutionRunRecord {
    const run = this.getExecutionRun(id)
    if (!run) throw new Error('execution_run_not_found')
    return run
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
