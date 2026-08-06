import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  SOFTWARE_PROJECT_TEMPLATE,
  isModelSlotForWorker,
  type ModelSlot,
  type WorkerTypeKind,
} from '@factoru/domain'

export interface WorkerTypeRecord {
  projectId: string
  kind: WorkerTypeKind
  displayName: string
  promptOverride: string | null
  defaultFormula: string | null
  capacity: number
  allowedTools: string[]
  memoryPolicy: 'provenance_required'
  version: number
  modelBindings: Array<{
    slot: ModelSlot
    provider: string | null
    model: string | null
    version: number
  }>
  updatedAt: string
}

export interface ConversationRecord {
  id: string
  projectId: string
  gasCityAccountId: string
  gasCityConversationId: string
  agentName: string
  transcriptCursor: number
  status: 'connecting' | 'ready' | 'offline' | 'needs_attention'
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface ConversationMessageRecord {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  text: string
  authorDisplayName: string
  inReplyToMessageId: string | null
  gasCitySequence: number | null
  deliveryState: 'pending' | 'delivered' | 'failed'
  tokenInput: number | null
  tokenOutput: number | null
  toolActivity: unknown[]
  createdAt: string
}

export interface MemoryEntryRecord {
  id: string
  projectId: string
  scope: 'project' | 'worker_type'
  workerTypeKind: WorkerTypeKind | null
  content: string
  provenanceKind: 'user_message' | 'user_edit' | 'task_evidence' | 'system_import'
  provenanceRef: string
  version: number
  supersedesId: string | null
  createdAt: string
}

interface WorkerRow {
  project_id: string
  kind: WorkerTypeKind
  display_name: string
  prompt_override: string | null
  default_formula: string | null
  capacity: number
  allowed_tools_json: string
  memory_policy: 'provenance_required'
  version: number
  updated_at: string
}

interface BindingRow {
  worker_type_kind: WorkerTypeKind
  slot: ModelSlot
  provider: string | null
  model: string | null
  version: number
}

interface ConversationRow {
  id: string
  project_id: string
  gas_city_account_id: string
  gas_city_conversation_id: string
  agent_name: string
  transcript_cursor: number
  status: ConversationRecord['status']
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  conversation_id: string
  role: ConversationMessageRecord['role']
  text: string
  author_display_name: string
  in_reply_to_message_id: string | null
  gas_city_sequence: number | null
  delivery_state: ConversationMessageRecord['deliveryState']
  token_input: number | null
  token_output: number | null
  tool_activity_json: string
  created_at: string
}

interface MemoryRow {
  id: string
  project_id: string
  scope: MemoryEntryRecord['scope']
  worker_type_kind: WorkerTypeKind | null
  content: string
  provenance_kind: MemoryEntryRecord['provenanceKind']
  provenance_ref: string
  version: number
  supersedes_id: string | null
  created_at: string
}

export function initializeProjectProductModel(
  db: Database.Database,
  projectId: string,
  createdAt: string,
): void {
  const template = SOFTWARE_PROJECT_TEMPLATE
  db.prepare(
    `INSERT INTO factory_settings(
       project_id, template_id, template_version, max_parallel_implementation_workers,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    projectId,
    template.id,
    template.version,
    template.factory.maxParallelImplementationWorkers,
    createdAt,
    createdAt,
  )

  for (const worker of template.workerTypes) {
    db.prepare(
      `INSERT INTO worker_types(
         project_id, kind, display_name, prompt_override, default_formula, capacity,
         allowed_tools_json, memory_policy, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      worker.kind,
      worker.displayName,
      worker.promptOverride,
      worker.defaultFormula,
      worker.capacity,
      JSON.stringify(worker.allowedTools),
      worker.memoryPolicy,
      createdAt,
      createdAt,
    )
    for (const binding of worker.modelBindings) {
      db.prepare(
        `INSERT INTO worker_model_bindings(
           project_id, worker_type_kind, slot, provider, model, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(projectId, worker.kind, binding.slot, binding.provider, binding.model, createdAt)
    }
  }

  const suffix = projectId.startsWith('prj_') ? projectId.slice(4) : projectId
  const conversationId = `conv_${suffix}`
  db.prepare(
    `INSERT INTO conversations(
       id, project_id, kind, gas_city_account_id, gas_city_conversation_id, agent_name,
       created_at, updated_at
     ) VALUES (?, ?, 'project_manager', 'factoru-server', ?, ?, ?, ?)`,
  ).run(
    conversationId,
    projectId,
    conversationId,
    `project-manager-chat-${suffix.slice(0, 12)}`,
    createdAt,
    createdAt,
  )
}

function conversationFromRow(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    gasCityAccountId: row.gas_city_account_id,
    gasCityConversationId: row.gas_city_conversation_id,
    agentName: row.agent_name,
    transcriptCursor: row.transcript_cursor,
    status: row.status,
    errorCode: row.last_error_code,
    errorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function messageFromRow(row: MessageRow): ConversationMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    text: row.text,
    authorDisplayName: row.author_display_name,
    inReplyToMessageId: row.in_reply_to_message_id,
    gasCitySequence: row.gas_city_sequence,
    deliveryState: row.delivery_state,
    tokenInput: row.token_input,
    tokenOutput: row.token_output,
    toolActivity: JSON.parse(row.tool_activity_json) as unknown[],
    createdAt: row.created_at,
  }
}

function memoryFromRow(row: MemoryRow): MemoryEntryRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope,
    workerTypeKind: row.worker_type_kind,
    content: row.content,
    provenanceKind: row.provenance_kind,
    provenanceRef: row.provenance_ref,
    version: row.version,
    supersedesId: row.supersedes_id,
    createdAt: row.created_at,
  }
}

export class ProductStore {
  readonly #db: Database.Database
  readonly #now: () => Date

  constructor(db: Database.Database, now: () => Date = () => new Date()) {
    this.#db = db
    this.#now = now
  }

  factorySettings(projectId: string): {
    templateId: string
    templateVersion: number
    maxParallelImplementationWorkers: 1
  } | null {
    const row = this.#db
      .prepare(
        `SELECT template_id, template_version, max_parallel_implementation_workers
         FROM factory_settings WHERE project_id = ?`,
      )
      .get(projectId) as
      | {
          template_id: string
          template_version: number
          max_parallel_implementation_workers: 1
        }
      | undefined
    return row
      ? {
          templateId: row.template_id,
          templateVersion: row.template_version,
          maxParallelImplementationWorkers: row.max_parallel_implementation_workers,
        }
      : null
  }

  listWorkerTypes(projectId: string): WorkerTypeRecord[] {
    const workers = this.#db
      .prepare('SELECT * FROM worker_types WHERE project_id = ? ORDER BY kind')
      .all(projectId) as WorkerRow[]
    const bindings = this.#db
      .prepare(
        `SELECT worker_type_kind, slot, provider, model, version
         FROM worker_model_bindings WHERE project_id = ? ORDER BY worker_type_kind, slot`,
      )
      .all(projectId) as BindingRow[]
    return workers.map((worker) => ({
      projectId: worker.project_id,
      kind: worker.kind,
      displayName: worker.display_name,
      promptOverride: worker.prompt_override,
      defaultFormula: worker.default_formula,
      capacity: worker.capacity,
      allowedTools: JSON.parse(worker.allowed_tools_json) as string[],
      memoryPolicy: worker.memory_policy,
      version: worker.version,
      modelBindings: bindings
        .filter((binding) => binding.worker_type_kind === worker.kind)
        .map((binding) => ({
          slot: binding.slot,
          provider: binding.provider,
          model: binding.model,
          version: binding.version,
        })),
      updatedAt: worker.updated_at,
    }))
  }

  updateModelBinding(
    projectId: string,
    workerTypeKind: WorkerTypeKind,
    slot: string,
    provider: string | null,
    model: string | null,
  ): WorkerTypeRecord {
    if (!isModelSlotForWorker(workerTypeKind, slot)) throw new Error('invalid_model_slot')
    if ((provider === null) !== (model === null)) throw new Error('incomplete_model_binding')
    const now = this.#now().toISOString()
    return this.#db.transaction(() => {
      const updated = this.#db
        .prepare(
          `UPDATE worker_model_bindings SET provider = ?, model = ?, version = version + 1,
             updated_at = ?
           WHERE project_id = ? AND worker_type_kind = ? AND slot = ?`,
        )
        .run(provider, model, now, projectId, workerTypeKind, slot)
      if (updated.changes !== 1) throw new Error('worker_type_not_found')
      this.#db
        .prepare(
          'UPDATE worker_types SET version = version + 1, updated_at = ? WHERE project_id = ? AND kind = ?',
        )
        .run(now, projectId, workerTypeKind)
      const worker = this.listWorkerTypes(projectId).find((item) => item.kind === workerTypeKind)!
      this.#appendEvent(
        'worker_type.model_binding_updated',
        'worker_type',
        projectId,
        worker.version,
        {
          workerTypeKind,
          slot,
          configured: provider !== null,
        },
      )
      return worker
    })()
  }

  getConversation(projectId: string): ConversationRecord | null {
    const row = this.#db
      .prepare('SELECT * FROM conversations WHERE project_id = ?')
      .get(projectId) as ConversationRow | undefined
    return row ? conversationFromRow(row) : null
  }

  listMessages(conversationId: string, limit = 200): ConversationMessageRecord[] {
    return (
      this.#db
        .prepare(
          `SELECT * FROM conversation_messages WHERE conversation_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(conversationId, limit) as MessageRow[]
    )
      .reverse()
      .map(messageFromRow)
  }

  addUserMessage(
    conversationId: string,
    text: string,
    authorDisplayName: string,
  ): ConversationMessageRecord {
    const normalized = text.trim()
    if (!normalized) throw new Error('empty_message')
    const now = this.#now().toISOString()
    const id = `msg_${randomUUID().replaceAll('-', '')}`
    this.#db
      .prepare(
        `INSERT INTO conversation_messages(
           id, conversation_id, role, text, author_display_name, delivery_state, created_at
         ) VALUES (?, ?, 'user', ?, ?, 'pending', ?)`,
      )
      .run(id, conversationId, normalized, authorDisplayName, now)
    return messageFromRow(
      this.#db.prepare('SELECT * FROM conversation_messages WHERE id = ?').get(id) as MessageRow,
    )
  }

  storeTranscriptMessage(
    conversationId: string,
    input: {
      sequence: number
      role: 'user' | 'assistant'
      text: string
      authorDisplayName: string
      inReplyToMessageId?: string
      createdAt: string
    },
  ): ConversationMessageRecord {
    return this.#db.transaction(() => {
      const existing = this.#db
        .prepare(
          'SELECT * FROM conversation_messages WHERE conversation_id = ? AND gas_city_sequence = ?',
        )
        .get(conversationId, input.sequence) as MessageRow | undefined
      if (existing) return messageFromRow(existing)
      const id = `msg_${randomUUID().replaceAll('-', '')}`
      this.#db
        .prepare(
          `INSERT INTO conversation_messages(
             id, conversation_id, role, text, author_display_name, in_reply_to_message_id,
             gas_city_sequence, delivery_state, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', ?)`,
        )
        .run(
          id,
          conversationId,
          input.role,
          input.text,
          input.authorDisplayName,
          input.inReplyToMessageId ?? null,
          input.sequence,
          input.createdAt,
        )
      this.#db
        .prepare(
          `UPDATE conversations SET transcript_cursor = MAX(transcript_cursor, ?),
             status = 'ready', last_error_code = NULL, last_error_message = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.sequence, this.#now().toISOString(), conversationId)
      return messageFromRow(
        this.#db.prepare('SELECT * FROM conversation_messages WHERE id = ?').get(id) as MessageRow,
      )
    })()
  }

  addMemoryEntry(input: {
    projectId: string
    scope: 'project' | 'worker_type'
    workerTypeKind?: WorkerTypeKind
    content: string
    provenanceKind: MemoryEntryRecord['provenanceKind']
    provenanceRef: string
    supersedesId?: string
  }): MemoryEntryRecord {
    const content = input.content.trim()
    if (!content || !input.provenanceRef.trim()) throw new Error('memory_provenance_required')
    if ((input.scope === 'worker_type') !== (input.workerTypeKind !== undefined)) {
      throw new Error('invalid_memory_scope')
    }
    const version = input.supersedesId
      ? ((
          this.#db
            .prepare('SELECT version FROM memory_entries WHERE id = ?')
            .get(input.supersedesId) as { version: number } | undefined
        )?.version ?? 0) + 1
      : 1
    const row: MemoryRow = {
      id: `mem_${randomUUID().replaceAll('-', '')}`,
      project_id: input.projectId,
      scope: input.scope,
      worker_type_kind: input.workerTypeKind ?? null,
      content,
      provenance_kind: input.provenanceKind,
      provenance_ref: input.provenanceRef,
      version,
      supersedes_id: input.supersedesId ?? null,
      created_at: this.#now().toISOString(),
    }
    this.#db
      .prepare(
        `INSERT INTO memory_entries(
           id, project_id, scope, worker_type_kind, content, provenance_kind,
           provenance_ref, version, supersedes_id, created_at
         ) VALUES (@id, @project_id, @scope, @worker_type_kind, @content, @provenance_kind,
           @provenance_ref, @version, @supersedes_id, @created_at)`,
      )
      .run(row)
    return memoryFromRow(row)
  }

  listMemory(projectId: string): MemoryEntryRecord[] {
    return (
      this.#db
        .prepare('SELECT * FROM memory_entries WHERE project_id = ? ORDER BY created_at, id')
        .all(projectId) as MemoryRow[]
    ).map(memoryFromRow)
  }

  #appendEvent(
    type: string,
    aggregateType: string,
    aggregateId: string,
    aggregateVersion: number,
    payload: unknown,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO domain_events(
           event_id, type, aggregate_type, aggregate_id, aggregate_version,
           payload_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        type,
        aggregateType,
        aggregateId,
        aggregateVersion,
        JSON.stringify(payload),
        this.#now().toISOString(),
      )
  }
}
