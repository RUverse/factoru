import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type ConversationLifecycleState =
  'pending' | 'streaming' | 'completed' | 'cancelling' | 'cancelled' | 'failed'

export interface ArtifactRecord {
  id: string
  projectId: string
  conversationId: string
  createdByDeviceId: string
  fileName: string
  storageKey: string
  contentHash: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  sizeBytes: number
  width: number
  height: number
  provenance: 'picker' | 'paste' | 'drop'
  status: 'ready' | 'cancelled' | 'deleted'
  createdAt: string
  updatedAt: string
  retentionExpiresAt: string
  deletedAt: string | null
}

export type ContentPartRecord =
  | { id: string; kind: 'text'; ordinal: number; text: string }
  | { id: string; kind: 'image'; ordinal: number; artifact: ArtifactRecord }
  | {
      id: string
      kind: 'tool'
      ordinal: number
      name: string
      status: 'running' | 'completed' | 'failed'
      summary: string | null
      startedAt: string | null
      finishedAt: string | null
    }

export interface RichMessageRecord {
  id: string
  conversationId: string
  turnId: string | null
  role: 'user' | 'assistant'
  text: string
  authorDisplayName: string
  inReplyToMessageId: string | null
  gasCitySequence: number | null
  deliveryState: 'pending' | 'delivered' | 'failed'
  state: ConversationLifecycleState
  contentVersion: number
  tokenInput: number | null
  tokenOutput: number | null
  parts: ContentPartRecord[]
  createdAt: string
  updatedAt: string
}

export interface ConversationTurnRecord {
  id: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string | null
  gasCitySessionId: string | null
  state: ConversationLifecycleState
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface ConversationStreamEventRecord {
  sequence: number
  eventId: string
  conversationId: string
  turnId: string | null
  messageId: string | null
  contentPartId: string | null
  type: string
  payload: unknown
  occurredAt: string
}

interface MessageRow {
  id: string
  conversation_id: string
  turn_id: string | null
  role: 'user' | 'assistant'
  text: string
  author_display_name: string
  in_reply_to_message_id: string | null
  gas_city_sequence: number | null
  delivery_state: 'pending' | 'delivered' | 'failed'
  state: ConversationLifecycleState
  content_version: number
  token_input: number | null
  token_output: number | null
  created_at: string
  updated_at: string
}

interface TurnRow {
  id: string
  conversation_id: string
  user_message_id: string
  assistant_message_id: string | null
  gas_city_session_id: string | null
  state: ConversationLifecycleState
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface ArtifactRow {
  id: string
  project_id: string
  conversation_id: string
  created_by_device_id: string
  file_name: string
  storage_key: string
  content_hash: string
  mime_type: ArtifactRecord['mimeType']
  size_bytes: number
  width: number
  height: number
  provenance: ArtifactRecord['provenance']
  status: ArtifactRecord['status']
  created_at: string
  updated_at: string
  retention_expires_at: string
  deleted_at: string | null
}

function turnFromRow(row: TurnRow): ConversationTurnRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    gasCitySessionId: row.gas_city_session_id,
    state: row.state,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function artifactFromRow(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    createdByDeviceId: row.created_by_device_id,
    fileName: row.file_name,
    storageKey: row.storage_key,
    contentHash: row.content_hash,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    provenance: row.provenance,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    retentionExpiresAt: row.retention_expires_at,
    deletedAt: row.deleted_at,
  }
}

export class ConversationStore {
  readonly #db: Database.Database
  readonly #now: () => Date

  constructor(db: Database.Database, now: () => Date = () => new Date()) {
    this.#db = db
    this.#now = now
  }

  listMessages(
    conversationId: string,
    options: { limit?: number; before?: string } = {},
  ): { messages: RichMessageRecord[]; nextBefore: string | null; hasMore: boolean } {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const before = options.before
      ? (this.#db
          .prepare(
            'SELECT created_at, id FROM conversation_messages WHERE conversation_id = ? AND id = ?',
          )
          .get(conversationId, options.before) as { created_at: string; id: string } | undefined)
      : undefined
    if (options.before && !before) throw new Error('message_cursor_not_found')
    const rows = this.#db
      .prepare(
        `SELECT * FROM conversation_messages
         WHERE conversation_id = ?
           AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(
        conversationId,
        before?.created_at ?? null,
        before?.created_at ?? null,
        before?.created_at ?? null,
        before?.id ?? null,
        limit + 1,
      ) as MessageRow[]
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).reverse()
    return {
      messages: page.map((row) => this.#messageFromRow(row)),
      nextBefore: hasMore ? (page[0]?.id ?? null) : null,
      hasMore,
    }
  }

  getMessage(messageId: string): RichMessageRecord | null {
    const row = this.#db
      .prepare('SELECT * FROM conversation_messages WHERE id = ?')
      .get(messageId) as MessageRow | undefined
    return row ? this.#messageFromRow(row) : null
  }

  activeTurn(conversationId: string): ConversationTurnRecord | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM conversation_turns WHERE conversation_id = ?
         AND state IN ('pending', 'streaming', 'cancelling') ORDER BY created_at LIMIT 1`,
      )
      .get(conversationId) as TurnRow | undefined
    return row ? turnFromRow(row) : null
  }

  getTurn(turnId: string): ConversationTurnRecord | null {
    const row = this.#db.prepare('SELECT * FROM conversation_turns WHERE id = ?').get(turnId) as
      TurnRow | undefined
    return row ? turnFromRow(row) : null
  }

  addUserTurn(input: {
    conversationId: string
    text: string
    artifactIds: readonly string[]
    authorDisplayName: string
  }): { turn: ConversationTurnRecord; message: RichMessageRecord } {
    const text = input.text.trim()
    if (!text && input.artifactIds.length === 0) throw new Error('empty_message')
    if (this.activeTurn(input.conversationId)) throw new Error('conversation_turn_active')
    const scope = this.#db
      .prepare('SELECT project_id FROM conversations WHERE id = ?')
      .get(input.conversationId) as { project_id: string } | undefined
    if (!scope) throw new Error('conversation_not_found')
    const artifacts = input.artifactIds.map((id) => {
      const row = this.#db
        .prepare(
          `SELECT * FROM conversation_artifacts
           WHERE id = ? AND project_id = ? AND conversation_id = ? AND status = 'ready'`,
        )
        .get(id, scope.project_id, input.conversationId) as ArtifactRow | undefined
      if (!row) throw new Error('artifact_not_found')
      return artifactFromRow(row)
    })
    const now = this.#now().toISOString()
    const messageId = `msg_${randomUUID().replaceAll('-', '')}`
    const turnId = `turn_${randomUUID().replaceAll('-', '')}`
    return this.#db.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO conversation_turns(
             id, conversation_id, user_message_id, state, created_at, updated_at
           ) VALUES (?, ?, ?, 'pending', ?, ?)`,
        )
        .run(turnId, input.conversationId, messageId, now, now)
      this.#db
        .prepare(
          `INSERT INTO conversation_messages(
             id, conversation_id, turn_id, role, text, author_display_name,
             delivery_state, state, created_at, updated_at
           ) VALUES (?, ?, ?, 'user', ?, ?, 'pending', 'pending', ?, ?)`,
        )
        .run(messageId, input.conversationId, turnId, text, input.authorDisplayName, now, now)
      let ordinal = 0
      if (text) this.#insertTextPart(messageId, ordinal++, text, now)
      for (const artifact of artifacts)
        this.#insertImagePart(messageId, ordinal++, artifact.id, now)
      this.#db
        .prepare(
          `INSERT INTO outbox_items(
             id, kind, aggregate_id, payload_json, status, available_at, created_at, updated_at
           ) VALUES (?, 'conversation.deliver', ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          messageId,
          JSON.stringify({ conversationId: input.conversationId, messageId, turnId }),
          now,
          now,
          now,
        )
      this.#appendDomainEvent('conversation.message_added', scope.project_id, {
        conversationId: input.conversationId,
        messageId,
        turnId,
        role: 'user',
      })
      this.#appendStreamEvent(
        input.conversationId,
        'turn.started',
        {
          turnId,
          messageId,
        },
        { turnId, messageId },
      )
      return {
        turn: this.getTurn(turnId)!,
        message: this.getMessage(messageId)!,
      }
    })()
  }

  attachSession(turnId: string, sessionId: string): ConversationTurnRecord {
    const now = this.#now().toISOString()
    this.#db
      .prepare(
        `UPDATE conversation_turns SET gas_city_session_id = ?, state = 'streaming', updated_at = ?
         WHERE id = ? AND state = 'pending'`,
      )
      .run(sessionId, now, turnId)
    const turn = this.getTurn(turnId)
    if (!turn) throw new Error('conversation_turn_not_found')
    this.#appendStreamEvent(turn.conversationId, 'assistant.started', { turnId }, { turnId })
    return turn
  }

  upsertAssistantProjection(input: {
    turnId: string
    providerMessageId: string
    text: string
    tools: readonly {
      id: string
      name: string
      status: 'running' | 'completed' | 'failed'
      summary?: string
      startedAt?: string
      finishedAt?: string
    }[]
    tokenInput?: number
    tokenOutput?: number
    createdAt?: string
  }): RichMessageRecord {
    return this.#db.transaction(() => {
      const turn = this.getTurn(input.turnId)
      if (!turn) throw new Error('conversation_turn_not_found')
      if (['cancelled', 'failed', 'completed'].includes(turn.state)) {
        const current = turn.assistantMessageId ? this.getMessage(turn.assistantMessageId) : null
        if (current) return current
        throw new Error('conversation_turn_terminal')
      }
      const now = this.#now().toISOString()
      const existing = turn.assistantMessageId ? this.getMessage(turn.assistantMessageId) : null
      const messageId = existing?.id ?? `msg_${randomUUID().replaceAll('-', '')}`
      const previousTools = new Map(
        (existing?.parts ?? [])
          .filter(
            (part): part is Extract<ContentPartRecord, { kind: 'tool' }> => part.kind === 'tool',
          )
          .map((part) => [part.id, part]),
      )
      const sameTools =
        previousTools.size === input.tools.length &&
        input.tools.every((tool) => {
          const previous = previousTools.get(this.#toolPartId(messageId, tool.id))
          return (
            previous?.name === tool.name &&
            previous.status === tool.status &&
            previous.summary === (tool.summary ?? null) &&
            previous.startedAt === (tool.startedAt ?? null) &&
            previous.finishedAt === (tool.finishedAt ?? null)
          )
        })
      if (
        existing &&
        existing.text === input.text &&
        existing.tokenInput === (input.tokenInput ?? existing.tokenInput) &&
        existing.tokenOutput === (input.tokenOutput ?? existing.tokenOutput) &&
        sameTools
      ) {
        return existing
      }
      if (!existing) {
        this.#db
          .prepare(
            `INSERT INTO conversation_messages(
               id, conversation_id, turn_id, role, text, author_display_name,
               in_reply_to_message_id, delivery_state, state, token_input, token_output,
               created_at, updated_at
             ) VALUES (?, ?, ?, 'assistant', ?, 'Project Manager', ?, 'pending', 'streaming', ?, ?, ?, ?)`,
          )
          .run(
            messageId,
            turn.conversationId,
            turn.id,
            input.text,
            turn.userMessageId,
            input.tokenInput ?? null,
            input.tokenOutput ?? null,
            input.createdAt ?? now,
            now,
          )
        this.#db
          .prepare(
            `UPDATE conversation_turns SET assistant_message_id = ?, state = 'streaming', updated_at = ?
             WHERE id = ?`,
          )
          .run(messageId, now, turn.id)
      } else {
        this.#db
          .prepare(
            `UPDATE conversation_messages SET text = ?, state = 'streaming',
               content_version = content_version + 1, token_input = ?, token_output = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            input.text,
            input.tokenInput ?? existing.tokenInput,
            input.tokenOutput ?? existing.tokenOutput,
            now,
            messageId,
          )
      }
      this.#db.prepare('DELETE FROM conversation_content_parts WHERE message_id = ?').run(messageId)
      let ordinal = 0
      if (input.text) this.#insertTextPart(messageId, ordinal++, input.text, now)
      for (const tool of input.tools) this.#insertToolPart(messageId, ordinal++, tool, now)
      const delta = !existing
        ? input.text
        : input.text.startsWith(existing.text)
          ? input.text.slice(existing.text.length)
          : ''
      this.#appendStreamEvent(
        turn.conversationId,
        delta ? 'assistant.text_delta' : 'assistant.replaced',
        { turnId: turn.id, messageId, providerMessageId: input.providerMessageId, delta },
        { turnId: turn.id, messageId },
      )
      for (const tool of input.tools) {
        const contentPartId = this.#toolPartId(messageId, tool.id)
        const previous = previousTools.get(contentPartId)
        const eventType =
          tool.status === 'completed'
            ? 'tool.completed'
            : tool.status === 'failed'
              ? 'tool.failed'
              : previous
                ? 'tool.updated'
                : 'tool.started'
        this.#appendStreamEvent(
          turn.conversationId,
          eventType,
          { turnId: turn.id, messageId, tool },
          { turnId: turn.id, messageId, contentPartId },
        )
      }
      return this.getMessage(messageId)!
    })()
  }

  completeAssistantTurn(input: {
    turnId: string
    sequence: number
    providerMessageId?: string
    text: string
    authorDisplayName: string
    createdAt: string
    tokenInput?: number
    tokenOutput?: number
  }): RichMessageRecord {
    return this.#db.transaction(() => {
      const turn = this.getTurn(input.turnId)
      if (!turn) throw new Error('conversation_turn_not_found')
      const projected = this.upsertAssistantProjection({
        turnId: turn.id,
        providerMessageId: input.providerMessageId ?? `sequence-${input.sequence}`,
        text: input.text,
        tools: turn.assistantMessageId
          ? (this.getMessage(turn.assistantMessageId)
              ?.parts.filter(
                (part): part is Extract<ContentPartRecord, { kind: 'tool' }> =>
                  part.kind === 'tool',
              )
              .map((part) => ({
                id: part.id,
                name: part.name,
                status: part.status === 'running' ? ('completed' as const) : part.status,
                summary: part.summary ?? undefined,
                startedAt: part.startedAt ?? undefined,
                finishedAt:
                  part.finishedAt ?? (part.status === 'running' ? input.createdAt : undefined),
              })) ?? [])
          : [],
        tokenInput: input.tokenInput,
        tokenOutput: input.tokenOutput,
        createdAt: input.createdAt,
      })
      const now = this.#now().toISOString()
      this.#db
        .prepare(
          `UPDATE conversation_messages SET text = ?, author_display_name = ?, gas_city_sequence = ?,
             delivery_state = 'delivered', state = 'completed', token_input = COALESCE(?, token_input),
             token_output = COALESCE(?, token_output), content_version = content_version + 1,
             updated_at = ? WHERE id = ?`,
        )
        .run(
          input.text,
          input.authorDisplayName || 'Project Manager',
          input.sequence,
          input.tokenInput ?? null,
          input.tokenOutput ?? null,
          now,
          projected.id,
        )
      this.#db
        .prepare(
          `UPDATE conversation_turns SET state = 'completed', completed_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(now, now, turn.id)
      this.#advanceConversationCursor(turn.conversationId, input.sequence)
      this.#appendStreamEvent(
        turn.conversationId,
        'assistant.completed',
        { turnId: turn.id, messageId: projected.id, sequence: input.sequence },
        { turnId: turn.id, messageId: projected.id },
      )
      return this.getMessage(projected.id)!
    })()
  }

  markUserDelivered(messageId: string, sequence?: number): RichMessageRecord {
    const now = this.#now().toISOString()
    const message = this.getMessage(messageId)
    if (!message) throw new Error('message_not_found')
    this.#db
      .prepare(
        `UPDATE conversation_messages SET delivery_state = 'delivered', state = 'completed',
           gas_city_sequence = COALESCE(?, gas_city_sequence), updated_at = ? WHERE id = ?`,
      )
      .run(sequence ?? null, now, messageId)
    if (sequence) this.#advanceConversationCursor(message.conversationId, sequence)
    return this.getMessage(messageId)!
  }

  requestCancellation(turnId: string): ConversationTurnRecord {
    const turn = this.getTurn(turnId)
    if (!turn) throw new Error('conversation_turn_not_found')
    if (!['pending', 'streaming'].includes(turn.state)) return turn
    const now = this.#now().toISOString()
    this.#db
      .prepare(`UPDATE conversation_turns SET state = 'cancelling', updated_at = ? WHERE id = ?`)
      .run(now, turnId)
    if (turn.assistantMessageId) {
      this.#db
        .prepare(
          `UPDATE conversation_messages SET state = 'cancelling', updated_at = ? WHERE id = ?`,
        )
        .run(now, turn.assistantMessageId)
    }
    this.#appendStreamEvent(turn.conversationId, 'assistant.cancelling', { turnId }, { turnId })
    return this.getTurn(turnId)!
  }

  finishCancellation(turnId: string): ConversationTurnRecord {
    const turn = this.getTurn(turnId)
    if (!turn) throw new Error('conversation_turn_not_found')
    const now = this.#now().toISOString()
    this.#db
      .prepare(
        `UPDATE conversation_turns SET state = 'cancelled', completed_at = ?, updated_at = ?
         WHERE id = ? AND state IN ('pending', 'streaming', 'cancelling')`,
      )
      .run(now, now, turnId)
    if (turn.assistantMessageId) {
      this.#db
        .prepare(
          `UPDATE conversation_messages SET state = 'cancelled', updated_at = ? WHERE id = ?`,
        )
        .run(now, turn.assistantMessageId)
    }
    this.#db
      .prepare(
        `UPDATE conversation_messages SET state = 'cancelled', updated_at = ?
         WHERE id = ? AND state = 'pending'`,
      )
      .run(now, turn.userMessageId)
    this.#db
      .prepare(
        `UPDATE outbox_items SET status = 'failed', lease_expires_at = NULL,
           last_error = 'cancelled_by_user', updated_at = ?
         WHERE kind = 'conversation.deliver' AND aggregate_id = ?
           AND status IN ('pending', 'processing')`,
      )
      .run(now, turn.userMessageId)
    this.#appendStreamEvent(turn.conversationId, 'assistant.cancelled', { turnId }, { turnId })
    return this.getTurn(turnId)!
  }

  failTurn(turnId: string, code: string, message: string): ConversationTurnRecord {
    const turn = this.getTurn(turnId)
    if (!turn) throw new Error('conversation_turn_not_found')
    const now = this.#now().toISOString()
    this.#db
      .prepare(
        `UPDATE conversation_turns SET state = 'failed', error_code = ?, error_message = ?,
           completed_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(code, message, now, now, turnId)
    if (turn.assistantMessageId) {
      this.#db
        .prepare(
          `UPDATE conversation_messages SET state = 'failed', delivery_state = 'failed', updated_at = ?
           WHERE id = ?`,
        )
        .run(now, turn.assistantMessageId)
    }
    this.#db
      .prepare(
        `UPDATE conversation_messages SET state = 'failed', delivery_state = 'failed', updated_at = ?
         WHERE id = ? AND state IN ('pending', 'streaming', 'cancelling')`,
      )
      .run(now, turn.userMessageId)
    this.#appendStreamEvent(
      turn.conversationId,
      'assistant.failed',
      { turnId, code, message },
      { turnId },
    )
    return this.getTurn(turnId)!
  }

  createArtifact(
    input: Omit<ArtifactRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
  ): ArtifactRecord {
    const id = `art_${randomUUID().replaceAll('-', '')}`
    const now = this.#now().toISOString()
    this.#db
      .prepare(
        `INSERT INTO conversation_artifacts(
           id, project_id, conversation_id, created_by_device_id, file_name, storage_key,
           content_hash, mime_type, size_bytes, width, height, provenance, status,
           created_at, updated_at, retention_expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.conversationId,
        input.createdByDeviceId,
        input.fileName,
        input.storageKey,
        input.contentHash,
        input.mimeType,
        input.sizeBytes,
        input.width,
        input.height,
        input.provenance,
        now,
        now,
        input.retentionExpiresAt,
      )
    return this.getArtifact(id)!
  }

  getArtifact(id: string): ArtifactRecord | null {
    const row = this.#db.prepare('SELECT * FROM conversation_artifacts WHERE id = ?').get(id) as
      ArtifactRow | undefined
    return row ? artifactFromRow(row) : null
  }

  artifactBytesInProject(projectId: string): number {
    return Number(
      (
        this.#db
          .prepare(
            `SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM conversation_artifacts
             WHERE project_id = ? AND status = 'ready'`,
          )
          .get(projectId) as { bytes: number }
      ).bytes,
    )
  }

  markArtifactDeleted(id: string): ArtifactRecord | null {
    const now = this.#now().toISOString()
    this.#db
      .prepare(
        `UPDATE conversation_artifacts SET status = 'deleted', deleted_at = ?, updated_at = ?
         WHERE id = ? AND status = 'ready'
           AND NOT EXISTS (
             SELECT 1 FROM conversation_content_parts WHERE artifact_id = conversation_artifacts.id
           )`,
      )
      .run(now, now, id)
    return this.getArtifact(id)
  }

  expiredUnreferencedArtifacts(now = this.#now().toISOString(), limit = 100): ArtifactRecord[] {
    return (
      this.#db
        .prepare(
          `SELECT a.* FROM conversation_artifacts a
           WHERE a.status = 'ready' AND a.retention_expires_at <= ?
             AND NOT EXISTS (SELECT 1 FROM conversation_content_parts p WHERE p.artifact_id = a.id)
           ORDER BY a.retention_expires_at LIMIT ?`,
        )
        .all(now, limit) as ArtifactRow[]
    ).map(artifactFromRow)
  }

  createDeliveryGrant(
    artifactId: string,
    ttlMs = 15 * 60_000,
  ): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const now = this.#now()
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
    this.#db
      .prepare(
        `INSERT INTO artifact_delivery_grants(id, artifact_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), artifactId, tokenHash, expiresAt, now.toISOString())
    return { token, expiresAt }
  }

  consumeDeliveryGrant(artifactId: string, token: string): ArtifactRecord | null {
    const hash = createHash('sha256').update(token).digest('hex')
    const now = this.#now().toISOString()
    return this.#db.transaction(() => {
      const grant = this.#db
        .prepare(
          `SELECT id FROM artifact_delivery_grants
           WHERE artifact_id = ? AND token_hash = ? AND expires_at > ?`,
        )
        .get(artifactId, hash, now) as { id: string } | undefined
      if (!grant) return null
      this.#db
        .prepare('UPDATE artifact_delivery_grants SET used_at = COALESCE(used_at, ?) WHERE id = ?')
        .run(now, grant.id)
      return this.getArtifact(artifactId)
    })()
  }

  deleteExpiredDeliveryGrants(now = this.#now().toISOString()): number {
    return this.#db.prepare('DELETE FROM artifact_delivery_grants WHERE expires_at <= ?').run(now)
      .changes
  }

  streamEventsAfter(
    conversationId: string,
    sequence: number,
    limit = 500,
  ): ConversationStreamEventRecord[] {
    return (
      this.#db
        .prepare(
          `SELECT * FROM conversation_stream_events
           WHERE conversation_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`,
        )
        .all(conversationId, sequence, limit) as Array<{
        sequence: number
        event_id: string
        conversation_id: string
        turn_id: string | null
        message_id: string | null
        content_part_id: string | null
        type: string
        payload_json: string
        occurred_at: string
      }>
    ).map((row) => ({
      sequence: row.sequence,
      eventId: row.event_id,
      conversationId: row.conversation_id,
      turnId: row.turn_id,
      messageId: row.message_id,
      contentPartId: row.content_part_id,
      type: row.type,
      payload: JSON.parse(row.payload_json),
      occurredAt: row.occurred_at,
    }))
  }

  currentStreamCursor(conversationId: string): number {
    return Number(
      (
        this.#db
          .prepare('SELECT stream_cursor FROM conversations WHERE id = ?')
          .get(conversationId) as { stream_cursor: number } | undefined
      )?.stream_cursor ?? 0,
    )
  }

  advanceTranscriptCursor(conversationId: string, sequence: number): void {
    this.#advanceConversationCursor(conversationId, sequence)
  }

  oldestReplayCursor(conversationId: string, window = 500): number {
    return Math.max(0, this.currentStreamCursor(conversationId) - window)
  }

  #messageFromRow(row: MessageRow): RichMessageRecord {
    const parts = this.#db
      .prepare(
        `SELECT p.*, a.id AS artifact_join_id, a.project_id, a.conversation_id,
           a.created_by_device_id, a.file_name, a.storage_key, a.content_hash, a.mime_type,
           a.size_bytes, a.width, a.height, a.provenance, a.status AS artifact_status,
           a.created_at AS artifact_created_at, a.updated_at AS artifact_updated_at,
           a.retention_expires_at, a.deleted_at
         FROM conversation_content_parts p
         LEFT JOIN conversation_artifacts a ON a.id = p.artifact_id
         WHERE p.message_id = ? ORDER BY p.ordinal`,
      )
      .all(row.id) as Array<Record<string, unknown>>
    return {
      id: row.id,
      conversationId: row.conversation_id,
      turnId: row.turn_id,
      role: row.role,
      text: row.text,
      authorDisplayName: row.author_display_name,
      inReplyToMessageId: row.in_reply_to_message_id,
      gasCitySequence: row.gas_city_sequence,
      deliveryState: row.delivery_state,
      state: row.state,
      contentVersion: row.content_version,
      tokenInput: row.token_input,
      tokenOutput: row.token_output,
      parts: parts.map((part) => {
        const kind = part.kind as 'text' | 'image' | 'tool'
        if (kind === 'text') {
          return {
            id: String(part.id),
            kind,
            ordinal: Number(part.ordinal),
            text: String(part.text_content),
          }
        }
        if (kind === 'image') {
          return {
            id: String(part.id),
            kind,
            ordinal: Number(part.ordinal),
            artifact: artifactFromRow({
              id: String(part.artifact_join_id),
              project_id: String(part.project_id),
              conversation_id: String(part.conversation_id),
              created_by_device_id: String(part.created_by_device_id),
              file_name: String(part.file_name),
              storage_key: String(part.storage_key),
              content_hash: String(part.content_hash),
              mime_type: part.mime_type as ArtifactRecord['mimeType'],
              size_bytes: Number(part.size_bytes),
              width: Number(part.width),
              height: Number(part.height),
              provenance: part.provenance as ArtifactRecord['provenance'],
              status: part.artifact_status as ArtifactRecord['status'],
              created_at: String(part.artifact_created_at),
              updated_at: String(part.artifact_updated_at),
              retention_expires_at: String(part.retention_expires_at),
              deleted_at: part.deleted_at === null ? null : String(part.deleted_at),
            }),
          }
        }
        return {
          id: String(part.id),
          kind,
          ordinal: Number(part.ordinal),
          name: String(part.tool_name),
          status: part.tool_status as 'running' | 'completed' | 'failed',
          summary: part.tool_summary === null ? null : String(part.tool_summary),
          startedAt: part.tool_started_at === null ? null : String(part.tool_started_at),
          finishedAt: part.tool_finished_at === null ? null : String(part.tool_finished_at),
        }
      }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  #insertTextPart(messageId: string, ordinal: number, text: string, now: string): void {
    this.#db
      .prepare(
        `INSERT INTO conversation_content_parts(
           id, message_id, ordinal, kind, text_content, created_at, updated_at
         ) VALUES (?, ?, ?, 'text', ?, ?, ?)`,
      )
      .run(`part_${randomUUID().replaceAll('-', '')}`, messageId, ordinal, text, now, now)
  }

  #insertImagePart(messageId: string, ordinal: number, artifactId: string, now: string): void {
    this.#db
      .prepare(
        `INSERT INTO conversation_content_parts(
           id, message_id, ordinal, kind, artifact_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'image', ?, ?, ?)`,
      )
      .run(`part_${randomUUID().replaceAll('-', '')}`, messageId, ordinal, artifactId, now, now)
  }

  #insertToolPart(
    messageId: string,
    ordinal: number,
    tool: {
      id: string
      name: string
      status: 'running' | 'completed' | 'failed'
      summary?: string
      startedAt?: string
      finishedAt?: string
    },
    now: string,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO conversation_content_parts(
           id, message_id, ordinal, kind, tool_name, tool_status, tool_summary,
           tool_started_at, tool_finished_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'tool', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.#toolPartId(messageId, tool.id),
        messageId,
        ordinal,
        tool.name,
        tool.status,
        tool.summary ?? null,
        tool.startedAt ?? null,
        tool.finishedAt ?? null,
        now,
        now,
      )
  }

  #toolPartId(messageId: string, providerId: string): string {
    if (/^part_[0-9a-f]{32}$/.test(providerId)) return providerId
    return `part_${createHash('sha256').update(`${messageId}:${providerId}`).digest('hex').slice(0, 32)}`
  }

  #appendStreamEvent(
    conversationId: string,
    type: string,
    payload: unknown,
    refs: { turnId?: string; messageId?: string; contentPartId?: string } = {},
  ): void {
    const now = this.#now().toISOString()
    const result = this.#db
      .prepare(
        `INSERT INTO conversation_stream_events(
           event_id, conversation_id, turn_id, message_id, content_part_id,
           type, payload_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        conversationId,
        refs.turnId ?? null,
        refs.messageId ?? null,
        refs.contentPartId ?? null,
        type,
        JSON.stringify(payload),
        now,
      )
    this.#db
      .prepare('UPDATE conversations SET stream_cursor = ?, updated_at = ? WHERE id = ?')
      .run(Number(result.lastInsertRowid), now, conversationId)
  }

  #appendDomainEvent(type: string, projectId: string, payload: unknown): void {
    this.#db
      .prepare(
        `INSERT INTO domain_events(
           event_id, type, aggregate_type, aggregate_id, aggregate_version,
           payload_json, command_id, occurred_at
         ) VALUES (?, ?, 'conversation', ?, 1, ?, NULL, ?)`,
      )
      .run(randomUUID(), type, projectId, JSON.stringify(payload), this.#now().toISOString())
  }

  #advanceConversationCursor(conversationId: string, sequence: number): void {
    this.#db
      .prepare(
        `UPDATE conversations SET transcript_cursor = MAX(transcript_cursor, ?), updated_at = ?
         WHERE id = ?`,
      )
      .run(sequence, this.#now().toISOString(), conversationId)
  }
}
