import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { WorkerTypeKind } from '@factoru/domain'
import type { TaskRecord, TaskStore } from './task-store.js'

export interface TaskEvidenceRecord {
  id: string
  taskId: string
  kind: 'request' | 'scope' | 'decision' | 'check' | 'review' | 'artifact'
  summary: string
  provenance: {
    kind: 'user_message' | 'pm_judgment' | 'task_run' | 'agent_report' | 'system'
    ref: string
  }
  createdAt: string
}
export interface TaskResourceIntentRecord {
  id: string
  taskId: string
  kind: 'repository_path' | 'service' | 'database' | 'exclusive_resource'
  name: string
  access: 'read' | 'write' | 'exclusive'
  createdAt: string
}
export interface MemoryProposalRecord {
  id: string
  projectId: string
  scope: 'project' | 'worker_type'
  workerTypeKind: WorkerTypeKind | null
  content: string
  provenance: { kind: string; ref: string }
  status: 'pending' | 'accepted' | 'rejected'
  proposedBy: string
  createdAt: string
  decidedAt: string | null
}
export interface RunDetailRecord {
  summary: Record<string, unknown> & { id: string; status: string; updatedAt: string }
  projection: {
    completeness: 'complete' | 'partial' | 'stale'
    cursor: number
    lastCompleteCursor: number
    reconciledAt: string | null
    reason: string | null
  }
  formula: {
    name: string
    version: string | null
    hash: string | null
    stages: Array<{
      id: string
      title: string
      ordinal: number
      status: string
      attempt: number
      maxAttempts: number
    }>
    edges: Array<{ from: string; to: string }>
  }
  convoy: {
    id: string | null
    drainPolicy: 'same-session'
    singleLane: true
    units: Array<{
      id: string
      title: string
      ordinal: number
      status: string
      dependencyIds: string[]
      sessionId: string | null
      attempt: number
    }>
  }
  sessions: Array<{
    id: string
    purpose: string
    status: string
    excerpts: Array<{
      sequence: number
      role: string
      text: string
      redacted: boolean
      createdAt: string
    }>
  }>
  artifacts: Array<{
    id: string
    kind: string
    label: string
    mediaType: string
    sizeBytes: number
    available: boolean
    createdAt: string
  }>
  specialistReports: Array<{
    id: string
    lane: string
    status: string
    summary: string
    findings: string[]
    artifactId: string | null
  }>
  synthesis: {
    status: string
    summary: string
    requestedCorrections: string[]
    artifactId: string | null
  } | null
  budgets: {
    verification: { used: number; limit: 2 }
    correction: { used: number; limit: 6 }
    transient: { used: number; limit: number }
  }
  usage: {
    inputTokens: number
    outputTokens: number
    estimatedCostUsd: number
    pricing: string
    partial: boolean
  }
  cancellation: { requestedAt: string | null; confirmedAt: string | null }
  recovery: { state: string; message: string | null }
}

type ResourceInput = Omit<TaskResourceIntentRecord, 'id' | 'taskId' | 'createdAt'>
type EvidenceInput = Pick<TaskEvidenceRecord, 'kind' | 'summary' | 'provenance'>

const PRIVILEGE_CLAIM =
  /\b(ignore|override|bypass)\b.{0,48}\b(instruction|policy|permission|system|developer)\b/iu
const SAFE_RESOURCE_NAME = /^[\p{L}\p{N}._-][\p{L}\p{N} ._:@/+-]{0,239}$/u

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return (
      (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) ||
      codePoint === 127
    )
  })
}

function assertProjectRef(value: string, projectId: string): void {
  if (!value || hasControlCharacters(value) || value.includes('..')) {
    throw new Error('invalid_foreign_reference')
  }
  if (/^(?:project|proj)_[a-z0-9]+:/iu.test(value) && !value.startsWith(`${projectId}:`)) {
    throw new Error('invalid_foreign_reference')
  }
}

function assertMemoryContent(content: string): string {
  const normalized = content.trim()
  if (!normalized || normalized.length > 4_096) throw new Error('invalid_memory_content')
  if (hasControlCharacters(normalized)) throw new Error('memory_control_characters_rejected')
  if (PRIVILEGE_CLAIM.test(normalized)) throw new Error('memory_privilege_claim_rejected')
  return normalized
}

function assertResource(input: ResourceInput): void {
  const name = input.name.trim()
  if (
    input.kind === 'repository_path' &&
    (name.startsWith('/') || name.startsWith('~') || name.split('/').includes('..'))
  ) {
    throw new Error('resource_path_traversal')
  }
  if (!SAFE_RESOURCE_NAME.test(name) || hasControlCharacters(name)) {
    throw new Error('invalid_resource_intent')
  }
  if (input.kind === 'exclusive_resource' && input.access !== 'exclusive') {
    throw new Error('exclusive_resource_requires_exclusive_access')
  }
}

interface MemoryProposalRow {
  id: string
  project_id: string
  scope: MemoryProposalRecord['scope']
  worker_type_kind: WorkerTypeKind | null
  content: string
  provenance_kind: string
  provenance_ref: string
  status: MemoryProposalRecord['status']
  proposed_by: string
  created_at: string
  decided_at: string | null
}

function proposalFromRow(row: MemoryProposalRow): MemoryProposalRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope,
    workerTypeKind: row.worker_type_kind,
    content: row.content,
    provenance: { kind: row.provenance_kind, ref: row.provenance_ref },
    status: row.status,
    proposedBy: row.proposed_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }
}

export class OrchestrationDepthStore {
  readonly #db: Database.Database
  readonly #tasks: TaskStore
  readonly #now: () => Date

  constructor(db: Database.Database, tasks: TaskStore, now: () => Date = () => new Date()) {
    this.#db = db
    this.#tasks = tasks
    this.#now = now
  }

  addEvidence(projectId: string, taskId: string, input: EvidenceInput): TaskEvidenceRecord {
    const task = this.#projectTask(projectId, taskId)
    const summary = input.summary.trim()
    if (!summary || summary.length > 4_096 || hasControlCharacters(summary)) {
      throw new Error('invalid_task_evidence')
    }
    assertProjectRef(input.provenance.ref, projectId)
    const evidence: TaskEvidenceRecord = {
      id: `evidence_${randomUUID().replaceAll('-', '')}`,
      taskId,
      kind: input.kind,
      summary,
      provenance: input.provenance,
      createdAt: this.#now().toISOString(),
    }
    this.#db.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO task_evidence(id, project_id, task_id, kind, summary, provenance_kind, provenance_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          evidence.id,
          projectId,
          taskId,
          evidence.kind,
          evidence.summary,
          evidence.provenance.kind,
          evidence.provenance.ref,
          evidence.createdAt,
        )
      this.#db
        .prepare('UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ?')
        .run(evidence.createdAt, task.id)
    })()
    return evidence
  }

  listEvidence(projectId: string, taskId: string): TaskEvidenceRecord[] {
    this.#projectTask(projectId, taskId)
    return (
      this.#db
        .prepare(
          `SELECT id, task_id, kind, summary, provenance_kind, provenance_ref, created_at
       FROM task_evidence WHERE project_id = ? AND task_id = ? ORDER BY created_at LIMIT 100`,
        )
        .all(projectId, taskId) as Array<Record<string, string>>
    ).map((row) => ({
      id: row.id!,
      taskId: row.task_id!,
      kind: row.kind as TaskEvidenceRecord['kind'],
      summary: row.summary!,
      provenance: {
        kind: row.provenance_kind as TaskEvidenceRecord['provenance']['kind'],
        ref: row.provenance_ref!,
      },
      createdAt: row.created_at!,
    }))
  }

  setResourceIntents(
    projectId: string,
    taskId: string,
    inputs: readonly ResourceInput[],
  ): TaskResourceIntentRecord[] {
    this.#projectTask(projectId, taskId)
    if (inputs.length > 32) throw new Error('resource_intent_limit_exceeded')
    inputs.forEach(assertResource)
    const seen = new Set<string>()
    for (const input of inputs) {
      const key = `${input.kind}:${input.name.trim()}`
      if (seen.has(key)) throw new Error('duplicate_resource_intent')
      seen.add(key)
    }
    const now = this.#now().toISOString()
    this.#db.transaction(() => {
      this.#db.prepare('DELETE FROM task_resource_intents WHERE task_id = ?').run(taskId)
      for (const input of inputs) {
        this.#db
          .prepare(
            `INSERT INTO task_resource_intents(id, project_id, task_id, kind, name, access, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `intent_${randomUUID().replaceAll('-', '')}`,
            projectId,
            taskId,
            input.kind,
            input.name.trim(),
            input.access,
            now,
          )
      }
      this.#db
        .prepare('UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ?')
        .run(now, taskId)
    })()
    return this.listResourceIntents(projectId, taskId)
  }

  listResourceIntents(projectId: string, taskId: string): TaskResourceIntentRecord[] {
    this.#projectTask(projectId, taskId)
    return (
      this.#db
        .prepare(
          `SELECT id, task_id, kind, name, access, created_at FROM task_resource_intents
       WHERE project_id = ? AND task_id = ? ORDER BY created_at, id`,
        )
        .all(projectId, taskId) as Array<Record<string, string>>
    ).map((row) => ({
      id: row.id!,
      taskId: row.task_id!,
      kind: row.kind as TaskResourceIntentRecord['kind'],
      name: row.name!,
      access: row.access as TaskResourceIntentRecord['access'],
      createdAt: row.created_at!,
    }))
  }

  splitTask(input: {
    projectId: string
    taskId: string
    reason: string
    children: readonly {
      title: string
      description: string
      resourceIntents?: readonly ResourceInput[]
    }[]
    actorKind: 'user' | 'pm_chat' | 'pm_planner'
    actorId: string
  }): { parent: TaskRecord; children: TaskRecord[] } {
    if (input.children.length < 2 || input.children.length > 8)
      throw new Error('task_split_size_invalid')
    const reason = input.reason.trim()
    if (!reason || reason.length > 4_096) throw new Error('task_split_reason_required')
    return this.#db.transaction(() => {
      const parent = this.#projectTask(input.projectId, input.taskId)
      if (parent.resolution || parent.status === 'in_progress' || parent.status === 'needs_you') {
        throw new Error('task_split_state_invalid')
      }
      const parentIntents = this.listResourceIntents(input.projectId, input.taskId).map(
        ({ kind, name, access }) => ({ kind, name, access }),
      )
      const created: TaskRecord[] = []
      for (const [index, child] of input.children.entries()) {
        const title = child.title.trim()
        if (!title) throw new Error('task_title_required')
        const intents = child.resourceIntents?.length ? child.resourceIntents : parentIntents
        if (intents.length > 32) throw new Error('resource_intent_limit_exceeded')
        intents.forEach(assertResource)
        const task = this.#tasks.create({
          projectId: input.projectId,
          title,
          description: child.description,
          status: 'queue',
          source: input.actorKind,
          actorKind: input.actorKind,
          actorId: input.actorId,
        })
        this.#db
          .prepare(
            `UPDATE tasks SET priority = ?, queue_order = ?, worker_type_kind = ?, formula_name = ?,
             workflow_preset_id = ?, workflow_selection_source = ?, workflow_locked_by_user = ? WHERE id = ?`,
          )
          .run(
            parent.priority,
            parent.queueOrder + index,
            parent.workerTypeKind,
            parent.formulaName,
            parent.workflowPresetId,
            parent.workflowSelectionSource,
            parent.workflowLockedByUser ? 1 : 0,
            task.id,
          )
        this.setResourceIntents(input.projectId, task.id, intents)
        created.push(this.#tasks.get(task.id)!)
      }
      for (const [index, child] of created.entries()) {
        const inherited = index === 0 ? parent.dependencyIds : [created[index - 1]!.id]
        this.#tasks.setDependencies({
          taskId: child.id,
          dependencyIds: inherited,
          actorKind: input.actorKind,
          actorId: input.actorId,
        })
        this.#db
          .prepare(
            `INSERT INTO task_supersessions(id, project_id, parent_task_id, child_task_id, kind, ordinal, reason, created_at)
           VALUES (?, ?, ?, ?, 'split', ?, ?, ?)`,
          )
          .run(
            `supersession_${randomUUID().replaceAll('-', '')}`,
            input.projectId,
            parent.id,
            child.id,
            index,
            reason,
            this.#now().toISOString(),
          )
      }
      this.#db
        .prepare(
          `UPDATE task_dependencies SET needs_task_id = ? WHERE needs_task_id = ? AND task_id NOT IN (${created.map(() => '?').join(',')})`,
        )
        .run(created.at(-1)!.id, parent.id, ...created.map((task) => task.id))
      const now = this.#now().toISOString()
      this.#db
        .prepare(
          `UPDATE tasks SET resolution = 'superseded', resolution_summary = ?, resolved_at = ?,
           merged_into_task_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND resolution IS NULL`,
        )
        .run(
          `Split into ${created.length} linked tasks: ${reason}`,
          now,
          created[0]!.id,
          now,
          parent.id,
        )
      return {
        parent: this.#tasks.get(parent.id)!,
        children: created.map((task) => this.#tasks.get(task.id)!),
      }
    })()
  }

  recordDuplicateDecision(input: {
    projectId: string
    sourceKind: 'new_request' | 'task'
    sourceRef: string
    candidateTaskId: string
    decision: 'append_evidence' | 'propose_merge' | 'new_task' | 'rejected'
    reason: string
    decidedBy: string
  }): void {
    this.#projectTask(input.projectId, input.candidateTaskId)
    assertProjectRef(input.sourceRef, input.projectId)
    this.#db
      .prepare(
        `INSERT INTO duplicate_decisions(id, project_id, source_kind, source_ref, candidate_task_id, decision, reason, decided_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `duplicate_${randomUUID().replaceAll('-', '')}`,
        input.projectId,
        input.sourceKind,
        input.sourceRef,
        input.candidateTaskId,
        input.decision,
        input.reason.trim(),
        input.decidedBy,
        this.#now().toISOString(),
      )
  }

  proposeMemory(input: {
    projectId: string
    scope: 'project' | 'worker_type'
    workerTypeKind?: WorkerTypeKind
    content: string
    provenanceKind: string
    provenanceRef: string
    proposedBy: string
  }): MemoryProposalRecord {
    const content = assertMemoryContent(input.content)
    if ((input.scope === 'worker_type') !== Boolean(input.workerTypeKind))
      throw new Error('invalid_memory_scope')
    assertProjectRef(input.provenanceRef, input.projectId)
    const id = `memory_proposal_${randomUUID().replaceAll('-', '')}`
    const now = this.#now().toISOString()
    this.#db
      .prepare(
        `INSERT INTO memory_proposals(id, project_id, scope, worker_type_kind, content, provenance_kind,
       provenance_ref, status, proposed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.scope,
        input.workerTypeKind ?? null,
        content,
        input.provenanceKind,
        input.provenanceRef,
        input.proposedBy,
        now,
      )
    return proposalFromRow(
      this.#db.prepare('SELECT * FROM memory_proposals WHERE id = ?').get(id) as MemoryProposalRow,
    )
  }

  decideMemory(
    projectId: string,
    proposalId: string,
    decision: 'accept' | 'reject',
  ): MemoryProposalRecord {
    return this.#db.transaction(() => {
      const proposal = this.#db
        .prepare('SELECT * FROM memory_proposals WHERE id = ? AND project_id = ?')
        .get(proposalId, projectId) as MemoryProposalRow | undefined
      if (!proposal || proposal.status !== 'pending') throw new Error('memory_proposal_not_found')
      const now = this.#now().toISOString()
      let memoryId: string | null = null
      if (decision === 'accept') {
        memoryId = `mem_${randomUUID().replaceAll('-', '')}`
        this.#db
          .prepare(
            `INSERT INTO memory_entries(id, project_id, scope, worker_type_kind, content, provenance_kind,
           provenance_ref, version, supersedes_id, created_at) VALUES (?, ?, ?, ?, ?, 'task_evidence', ?, 1, NULL, ?)`,
          )
          .run(
            memoryId,
            projectId,
            proposal.scope,
            proposal.worker_type_kind,
            proposal.content,
            proposal.provenance_ref,
            now,
          )
      }
      this.#db
        .prepare(
          `UPDATE memory_proposals SET status = ?, accepted_memory_id = ?, decided_at = ? WHERE id = ?`,
        )
        .run(decision === 'accept' ? 'accepted' : 'rejected', memoryId, now, proposalId)
      return proposalFromRow(
        this.#db
          .prepare('SELECT * FROM memory_proposals WHERE id = ?')
          .get(proposalId) as MemoryProposalRow,
      )
    })()
  }

  searchMemory(
    projectId: string,
    query: string,
    workerTypeKind?: WorkerTypeKind,
    limit = 8,
  ): Array<{
    id: string
    content: string
    provenance: { kind: string; ref: string }
    rendered: string
  }> {
    const tokens = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean)
    const rows = this.#db
      .prepare(
        `SELECT m.* FROM memory_entries m WHERE m.project_id = ?
       AND (m.scope = 'project' OR (m.scope = 'worker_type' AND m.worker_type_kind = ?))
       AND NOT EXISTS (SELECT 1 FROM memory_entries newer WHERE newer.supersedes_id = m.id)
       ORDER BY m.created_at DESC LIMIT 50`,
      )
      .all(projectId, workerTypeKind ?? null) as Array<{
      id: string
      content: string
      provenance_kind: string
      provenance_ref: string
    }>
    const ranked = rows
      .map((row) => ({
        row,
        score: tokens.reduce(
          (score, token) => score + (row.content.toLocaleLowerCase().includes(token) ? 1 : 0),
          0,
        ),
      }))
      .filter(({ score }) => tokens.length === 0 || score > 0)
      .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
    const result: Array<{
      id: string
      content: string
      provenance: { kind: string; ref: string }
      rendered: string
    }> = []
    let bytes = 0
    for (const { row } of ranked) {
      const size = Buffer.byteLength(row.content)
      if (result.length >= Math.min(limit, 8) || bytes + size > 4_096) continue
      bytes += size
      result.push({
        id: row.id,
        content: row.content,
        provenance: { kind: row.provenance_kind, ref: row.provenance_ref },
        rendered: `<untrusted-reference provenance="${row.provenance_kind}:${row.provenance_ref}">\n${row.content}\n</untrusted-reference>`,
      })
    }
    return result
  }

  snapshotRunMemory(runId: string, query: string, workerTypeKind: WorkerTypeKind): void {
    const run = this.#db.prepare('SELECT project_id FROM task_runs WHERE id = ?').get(runId) as
      { project_id: string } | undefined
    if (!run) throw new Error('execution_run_not_found')
    const entries = this.searchMemory(run.project_id, query, workerTypeKind, 8)
    this.#db.transaction(() => {
      this.#db.prepare('DELETE FROM run_memory_snapshots WHERE run_id = ?').run(runId)
      entries.forEach((entry, ordinal) =>
        this.#db
          .prepare(
            `INSERT INTO run_memory_snapshots(run_id, memory_entry_id, ordinal, content, provenance_json) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(runId, entry.id, ordinal, entry.content, JSON.stringify(entry.provenance)),
      )
    })()
  }

  saveFormulaPreview(
    runId: string,
    preview: {
      name: string
      stages: readonly { id: string; title: string }[]
      edges: readonly { from: string; to: string }[]
    },
  ): void {
    this.#db.transaction(() => {
      const run = this.#tasks.getExecutionRun(runId)
      if (!run) throw new Error('execution_run_not_found')
      this.#db.prepare('DELETE FROM run_dependencies WHERE run_id = ?').run(runId)
      this.#db.prepare('DELETE FROM run_stages WHERE run_id = ?').run(runId)
      preview.stages.forEach((stage, ordinal) =>
        this.#db
          .prepare(
            `INSERT INTO run_stages(run_id, stage_id, ordinal, title, status, attempt, max_attempts) VALUES (?, ?, ?, ?, 'pending', 0, ?)`,
          )
          .run(runId, stage.id, ordinal, stage.title, stage.id.includes('verify') ? 2 : 6),
      )
      preview.edges.forEach((edge) =>
        this.#db
          .prepare(
            `INSERT INTO run_dependencies(run_id, from_stage_id, to_stage_id) VALUES (?, ?, ?)`,
          )
          .run(runId, edge.from, edge.to),
      )
      const cursor = run.eventCursor + 1
      this.#db
        .prepare(
          `UPDATE task_runs SET event_cursor = ?, projection_state = 'partial', projection_reason = 'Run dispatch is pending after Formula preview.' WHERE id = ?`,
        )
        .run(cursor, runId)
      const detail = this.getRunDetail(runId)
      this.#db
        .prepare(
          `INSERT INTO run_stream_events(run_id, cursor, event_id, event_type, data_json, occurred_at) VALUES (?, ?, ?, 'run.formula_previewed', ?, ?)`,
        )
        .run(
          runId,
          cursor,
          `formula-preview:${runId}:${cursor}`,
          JSON.stringify(detail),
          this.#now().toISOString(),
        )
    })()
  }

  saveRunDetail(
    detail: RunDetailRecord,
    event: { id: string; type: string; occurredAt: string } | null = null,
  ): void {
    const runId = detail.summary.id
    this.#db.transaction(() => {
      const current = this.#db
        .prepare('SELECT status, event_cursor, gas_city_event_cursor FROM task_runs WHERE id = ?')
        .get(runId) as
        { status: string; event_cursor: number; gas_city_event_cursor: number } | undefined
      if (!current) throw new Error('execution_run_not_found')
      if (
        ['completed', 'failed', 'cancelled'].includes(current.status) &&
        !['completed', 'failed', 'cancelled'].includes(detail.summary.status)
      )
        return
      if (detail.projection.completeness !== 'complete') {
        this.#db
          .prepare(
            `UPDATE task_runs SET projection_state = ?, projection_reason = ?, gas_city_event_cursor = MAX(gas_city_event_cursor, ?), updated_at = ? WHERE id = ?`,
          )
          .run(
            detail.projection.completeness,
            detail.projection.reason,
            detail.projection.cursor,
            detail.summary.updatedAt,
            runId,
          )
      } else {
        this.#db
          .prepare(
            `UPDATE task_runs SET gas_city_convoy_id = ?, gas_city_event_cursor = MAX(gas_city_event_cursor, ?), projection_state = 'complete', projection_reason = NULL, projection_reconciled_at = ?, verification_attempts = ?, correction_attempts = ?, transient_attempts = ?, transient_attempt_limit = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            detail.convoy.id,
            detail.projection.cursor,
            detail.projection.reconciledAt,
            detail.budgets.verification.used,
            detail.budgets.correction.used,
            detail.budgets.transient.used,
            detail.budgets.transient.limit,
            detail.summary.updatedAt,
            runId,
          )
        this.#replaceProjection(runId, detail)
      }
      if (event) {
        const encoded = JSON.stringify(detail)
        const previous = this.#db
          .prepare(
            'SELECT data_json FROM run_stream_events WHERE run_id = ? ORDER BY cursor DESC LIMIT 1',
          )
          .get(runId) as { data_json: string } | undefined
        if (previous?.data_json !== encoded) {
          const streamCursor = current.event_cursor + 1
          this.#db
            .prepare(
              `INSERT INTO run_stream_events(run_id, cursor, event_id, event_type, data_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              runId,
              streamCursor,
              `${event.id}:${streamCursor}`,
              event.type,
              encoded,
              event.occurredAt,
            )
          this.#db
            .prepare(
              `UPDATE task_runs SET event_cursor = ?, last_complete_event_cursor = CASE WHEN projection_state = 'complete' THEN ? ELSE last_complete_event_cursor END WHERE id = ?`,
            )
            .run(streamCursor, streamCursor, runId)
        }
      }
    })()
  }

  getRunDetail(runId: string): RunDetailRecord {
    const summary = this.#tasks.getExecutionRun(runId)
    if (!summary) throw new Error('execution_run_not_found')
    const row = this.#db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId) as Record<
      string,
      unknown
    >
    const stages = this.#db
      .prepare('SELECT * FROM run_stages WHERE run_id = ? ORDER BY ordinal')
      .all(runId) as Array<Record<string, unknown>>
    const edges = this.#db
      .prepare('SELECT * FROM run_dependencies WHERE run_id = ?')
      .all(runId) as Array<Record<string, string>>
    const units = this.#db
      .prepare('SELECT * FROM run_units WHERE run_id = ? ORDER BY ordinal')
      .all(runId) as Array<Record<string, unknown>>
    const sessions = this.#db
      .prepare('SELECT * FROM run_sessions WHERE run_id = ?')
      .all(runId) as Array<Record<string, unknown>>
    const artifacts = this.#db
      .prepare(
        'SELECT id, kind, label, media_type, size_bytes, created_at FROM run_artifacts WHERE run_id = ? ORDER BY created_at',
      )
      .all(runId) as Array<Record<string, unknown>>
    const reviews = this.#db
      .prepare('SELECT * FROM run_reviews WHERE run_id = ?')
      .all(runId) as Array<Record<string, unknown>>
    const protocolSummary = {
      id: summary.id,
      taskId: summary.taskId,
      formulaName: summary.formulaName,
      formulaVersion: summary.formulaVersion,
      formulaHash: summary.formulaHash,
      workflowPresetId: summary.workflowPresetId,
      workflowPresetVersion: summary.workflowPresetVersion,
      resolvedVariables: summary.resolvedVariables,
      blueprintId: summary.blueprintId,
      blueprintVersion: summary.blueprintVersion,
      packLockDigest: summary.packLockDigest,
      sourceBeadId: summary.sourceBeadId,
      status: summary.status,
      stage: summary.stage,
      capsule:
        summary.capsuleId && summary.capsulePath && summary.branchName && summary.baseBranch
          ? {
              id: summary.capsuleId,
              path: '[server-managed capsule]',
              branchName: summary.branchName,
              baseBranch: summary.baseBranch,
            }
          : null,
      steps: summary.steps,
      logs: summary.logs.slice(-100),
      usage: summary.usage,
      reviewPackage: summary.reviewPackage
        ? { ...summary.reviewPackage, capsulePath: '[server-managed capsule]' }
        : null,
      error: summary.errorCode
        ? { code: summary.errorCode, message: summary.errorMessage ?? summary.errorCode }
        : null,
      createdAt: summary.createdAt,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      updatedAt: summary.updatedAt,
    }
    const mappedReviews = reviews
      .filter((review) => review.lane !== 'synthesis')
      .map((review) => ({
        id: `${runId}:${String(review.lane)}`,
        lane: review.lane as 'correctness_testing',
        status: review.status as 'pending',
        summary: String(review.summary),
        findings: JSON.parse(String(review.findings_json)) as string[],
        artifactId: review.artifact_id as string | null,
      }))
    const synthesis = reviews.find((review) => review.lane === 'synthesis')
    return {
      summary: protocolSummary,
      projection: {
        completeness: row.projection_state as 'partial',
        cursor: Number(row.event_cursor),
        lastCompleteCursor: Number(row.last_complete_event_cursor),
        reconciledAt: row.projection_reconciled_at as string | null,
        reason: row.projection_reason as string | null,
      },
      formula: {
        name: summary.formulaName,
        version: summary.formulaVersion,
        hash: summary.formulaHash,
        stages: stages.map((stage) => ({
          id: String(stage.stage_id),
          title: String(stage.title),
          ordinal: Number(stage.ordinal),
          status: stage.status as 'pending',
          attempt: Number(stage.attempt),
          maxAttempts: Number(stage.max_attempts),
        })),
        edges: edges.map((edge) => ({ from: edge.from_stage_id!, to: edge.to_stage_id! })),
      },
      convoy: {
        id: row.gas_city_convoy_id as string | null,
        drainPolicy: 'same-session',
        singleLane: true,
        units: units.map((unit) => ({
          id: String(unit.unit_id),
          title: String(unit.title),
          ordinal: Number(unit.ordinal),
          status: unit.status as 'pending',
          dependencyIds: JSON.parse(String(unit.dependency_ids_json)) as string[],
          sessionId: unit.session_id as string | null,
          attempt: Number(unit.attempt),
        })),
      },
      sessions: sessions.map((session) => ({
        id: String(session.session_id),
        purpose: session.purpose as 'implementation',
        status: session.status as 'unknown',
        excerpts: (
          this.#db
            .prepare(
              'SELECT * FROM run_transcript_excerpts WHERE run_id = ? AND session_id = ? ORDER BY sequence DESC LIMIT 40',
            )
            .all(runId, session.session_id) as Array<Record<string, unknown>>
        )
          .reverse()
          .map((excerpt) => ({
            sequence: Number(excerpt.sequence),
            role: excerpt.role as 'system',
            text: String(excerpt.text),
            redacted: Boolean(excerpt.redacted),
            createdAt: String(excerpt.created_at),
          })),
      })),
      artifacts: artifacts.map((artifact) => ({
        id: String(artifact.id),
        kind: artifact.kind as 'other',
        label: String(artifact.label),
        mediaType: String(artifact.media_type),
        sizeBytes: Number(artifact.size_bytes),
        available: true,
        createdAt: String(artifact.created_at),
      })),
      specialistReports: mappedReviews,
      synthesis: synthesis
        ? {
            status: synthesis.status as 'pending',
            summary: String(synthesis.summary),
            requestedCorrections: JSON.parse(String(synthesis.findings_json)) as string[],
            artifactId: synthesis.artifact_id as string | null,
          }
        : null,
      budgets: {
        verification: { used: Number(row.verification_attempts), limit: 2 },
        correction: { used: Number(row.correction_attempts), limit: 6 },
        transient: {
          used: Number(row.transient_attempts),
          limit: Number(row.transient_attempt_limit),
        },
      },
      usage: summary.usage,
      cancellation: {
        requestedAt: summary.status === 'cancelling' ? summary.updatedAt : null,
        confirmedAt: summary.status === 'cancelled' ? summary.finishedAt : null,
      },
      recovery: {
        state:
          row.projection_state === 'stale'
            ? 'needs_attention'
            : row.projection_reconciled_at
              ? 'reconciled'
              : 'current',
        message: row.projection_reason as string | null,
      },
    }
  }

  readArtifact(
    projectId: string,
    runId: string,
    artifactId: string,
  ): { mediaType: string; content: Buffer } {
    const run = this.#db.prepare('SELECT project_id FROM task_runs WHERE id = ?').get(runId) as
      { project_id: string } | undefined
    if (!run || run.project_id !== projectId) throw new Error('execution_run_not_found')
    const artifact = this.#db
      .prepare('SELECT media_type, content_blob FROM run_artifacts WHERE id = ? AND run_id = ?')
      .get(artifactId, runId) as { media_type: string; content_blob: Buffer | null } | undefined
    if (!artifact?.content_blob) throw new Error('run_artifact_not_available')
    return { mediaType: artifact.media_type, content: artifact.content_blob }
  }

  currentRunCursor(runId: string): number {
    const row = this.#db.prepare('SELECT event_cursor FROM task_runs WHERE id = ?').get(runId) as
      { event_cursor: number } | undefined
    if (!row) throw new Error('execution_run_not_found')
    return row.event_cursor
  }

  runEventsAfter(
    runId: string,
    cursor: number,
    limit = 500,
  ): Array<{
    cursor: number
    eventId: string
    type: string
    data: unknown
    occurredAt: string
  }> {
    return (
      this.#db
        .prepare(
          `SELECT cursor, event_id, event_type, data_json, occurred_at FROM run_stream_events
       WHERE run_id = ? AND cursor > ? ORDER BY cursor LIMIT ?`,
        )
        .all(runId, cursor, limit) as Array<{
        cursor: number
        event_id: string
        event_type: string
        data_json: string
        occurred_at: string
      }>
    ).map((row) => ({
      cursor: row.cursor,
      eventId: row.event_id,
      type: row.event_type,
      data: JSON.parse(row.data_json) as unknown,
      occurredAt: row.occurred_at,
    }))
  }

  #replaceProjection(runId: string, detail: RunDetailRecord): void {
    for (const table of [
      'run_dependencies',
      'run_units',
      'run_transcript_excerpts',
      'run_sessions',
      'run_reviews',
      'run_stages',
    ] as const)
      this.#db.prepare(`DELETE FROM ${table} WHERE run_id = ?`).run(runId)
    for (const stage of detail.formula.stages)
      this.#db
        .prepare(
          `INSERT INTO run_stages(run_id, stage_id, ordinal, title, status, attempt, max_attempts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          stage.id,
          stage.ordinal,
          stage.title,
          stage.status,
          stage.attempt,
          stage.maxAttempts,
        )
    for (const edge of detail.formula.edges)
      this.#db
        .prepare(
          `INSERT INTO run_dependencies(run_id, from_stage_id, to_stage_id) VALUES (?, ?, ?)`,
        )
        .run(runId, edge.from, edge.to)
    for (const unit of detail.convoy.units)
      this.#db
        .prepare(
          `INSERT INTO run_units(run_id, unit_id, ordinal, title, status, dependency_ids_json, session_id, attempt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          unit.id,
          unit.ordinal,
          unit.title,
          unit.status,
          JSON.stringify(unit.dependencyIds),
          unit.sessionId,
          unit.attempt,
        )
    for (const session of detail.sessions) {
      this.#db
        .prepare(
          `INSERT INTO run_sessions(run_id, session_id, purpose, status) VALUES (?, ?, ?, ?)`,
        )
        .run(runId, session.id, session.purpose, session.status)
      for (const excerpt of session.excerpts.slice(-40))
        this.#db
          .prepare(
            `INSERT INTO run_transcript_excerpts(run_id, session_id, sequence, role, text, redacted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            runId,
            session.id,
            excerpt.sequence,
            excerpt.role,
            excerpt.text.slice(0, 4_096),
            excerpt.redacted ? 1 : 0,
            excerpt.createdAt,
          )
    }
    for (const report of detail.specialistReports)
      this.#db
        .prepare(
          `INSERT INTO run_reviews(run_id, lane, status, summary, findings_json, artifact_id) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          report.lane,
          report.status,
          report.summary,
          JSON.stringify(report.findings),
          report.artifactId,
        )
    if (detail.synthesis)
      this.#db
        .prepare(
          `INSERT INTO run_reviews(run_id, lane, status, summary, findings_json, artifact_id) VALUES (?, 'synthesis', ?, ?, ?, ?)`,
        )
        .run(
          runId,
          detail.synthesis.status,
          detail.synthesis.summary,
          JSON.stringify(detail.synthesis.requestedCorrections),
          detail.synthesis.artifactId,
        )
  }

  storeArtifact(input: {
    runId: string
    kind: string
    label: string
    mediaType: string
    content: Buffer
  }): string {
    if (input.content.byteLength > 2 * 1024 * 1024) throw new Error('run_artifact_too_large')
    const id = `run_artifact_${randomUUID().replaceAll('-', '')}`
    this.#db
      .prepare(
        `INSERT INTO run_artifacts(id, run_id, kind, label, media_type, size_bytes, storage_ref, content_blob, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.kind,
        input.label,
        input.mediaType,
        input.content.byteLength,
        id,
        input.content,
        createHash('sha256').update(input.content).digest('hex'),
        this.#now().toISOString(),
      )
    return id
  }

  #projectTask(projectId: string, taskId: string): TaskRecord {
    const task = this.#tasks.get(taskId)
    if (!task || task.projectId !== projectId) throw new Error('task_not_found')
    return task
  }
}
