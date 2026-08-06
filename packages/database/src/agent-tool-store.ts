import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'

export type AgentRole = 'pm_chat' | 'pm_planner' | 'software_implementer' | 'software_reviewer'

export interface AgentToolCredentialRecord {
  id: string
  projectId: string
  role: AgentRole
  sessionId: string
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

export interface AgentToolAuditReplay {
  outcome: 'accepted' | 'denied' | 'failed'
  response: unknown
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function equalHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export class AgentToolStore {
  readonly #db: Database.Database
  readonly #now: () => Date

  constructor(db: Database.Database, now: () => Date = () => new Date()) {
    this.#db = db
    this.#now = now
  }

  mint(
    projectId: string,
    role: AgentRole,
    sessionId: string,
    ttlMs = 12 * 60 * 60_000,
  ): {
    credential: AgentToolCredentialRecord
    token: string
  } {
    const normalizedSession = sessionId.trim()
    if (!normalizedSession) throw new Error('agent_session_required')
    const now = this.#now()
    const id = `agt_${randomUUID().replaceAll('-', '')}`
    const secret = randomBytes(32).toString('base64url')
    const token = `${id}.${secret}`
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
    return this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE agent_tool_credentials SET revoked_at = ?
           WHERE project_id = ? AND role = ? AND session_id = ? AND revoked_at IS NULL`,
        )
        .run(now.toISOString(), projectId, role, normalizedSession)
      this.#db
        .prepare(
          `INSERT INTO agent_tool_credentials(
             id, token_hash, project_id, role, session_id, expires_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          hashToken(secret),
          projectId,
          role,
          normalizedSession,
          expiresAt,
          now.toISOString(),
        )
      return {
        credential: {
          id,
          projectId,
          role,
          sessionId: normalizedSession,
          expiresAt,
          revokedAt: null,
          createdAt: now.toISOString(),
        },
        token,
      }
    })()
  }

  authenticate(rawToken: string): AgentToolCredentialRecord | null {
    const separator = rawToken.indexOf('.')
    if (separator < 1) return null
    const id = rawToken.slice(0, separator)
    const secret = rawToken.slice(separator + 1)
    const row = this.#db.prepare('SELECT * FROM agent_tool_credentials WHERE id = ?').get(id) as
      | {
          id: string
          token_hash: string
          project_id: string
          role: AgentRole
          session_id: string
          expires_at: string
          revoked_at: string | null
          created_at: string
        }
      | undefined
    if (
      !row ||
      row.revoked_at ||
      row.expires_at <= this.#now().toISOString() ||
      !equalHash(row.token_hash, hashToken(secret))
    ) {
      return null
    }
    return {
      id: row.id,
      projectId: row.project_id,
      role: row.role,
      sessionId: row.session_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    }
  }

  replay(credentialId: string, requestId: string): AgentToolAuditReplay | null {
    const row = this.#db
      .prepare(
        `SELECT outcome, response_json FROM agent_tool_audit
         WHERE credential_id = ? AND request_id = ?`,
      )
      .get(credentialId, requestId) as
      { outcome: AgentToolAuditReplay['outcome']; response_json: string } | undefined
    return row ? { outcome: row.outcome, response: JSON.parse(row.response_json) as unknown } : null
  }

  record(input: {
    credential: AgentToolCredentialRecord
    toolName: string
    requestId: string
    outcome: AgentToolAuditReplay['outcome']
    summary: unknown
    response: unknown
  }): AgentToolAuditReplay {
    const replay = this.replay(input.credential.id, input.requestId)
    if (replay) return replay
    this.#db
      .prepare(
        `INSERT INTO agent_tool_audit(
           id, credential_id, project_id, role, tool_name, request_id, outcome,
           summary_json, response_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.credential.id,
        input.credential.projectId,
        input.credential.role,
        input.toolName,
        input.requestId,
        input.outcome,
        JSON.stringify(input.summary),
        JSON.stringify(input.response),
        this.#now().toISOString(),
      )
    return { outcome: input.outcome, response: input.response }
  }
}
