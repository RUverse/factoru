import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import Database from 'better-sqlite3'
import type { ServerId } from '@factoru/domain'
import { applyMigrations } from './migrations.js'
import { initializeProjectProductModel, ProductStore } from './product-store.js'
import { TaskStore } from './task-store.js'
import { AgentToolStore } from './agent-tool-store.js'

export const OWNER_SCOPES = [
  'projects:read',
  'projects:write',
  'events:read',
  'devices:read',
  'devices:revoke',
] as const
export type OwnerScope = (typeof OWNER_SCOPES)[number]
export type ProjectSetupState = 'setting_up' | 'ready' | 'needs_attention'

export interface TrustedDevice {
  id: string
  name: string
  scopes: readonly OwnerScope[]
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

export interface ProjectRecord {
  id: string
  name: string
  description: string | null
  repositoryRootId: string
  repositoryRelativePath: string
  repositoryRealPath: string
  defaultBranch: string
  setupState: ProjectSetupState
  setupErrorCode: string | null
  setupErrorMessage: string | null
  version: number
  createdAt: string
  updatedAt: string
  rig: RigBindingRecord
}

export interface RigBindingRecord {
  cityName: string
  rigName: string
  beadPrefix: string
  registrationState: 'pending' | 'ready' | 'failed'
  lastReconciledAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
}

export interface DomainEventRecord {
  sequence: number
  eventId: string
  type: string
  aggregateId: string
  aggregateVersion: number
  payload: unknown
  occurredAt: string
}

export interface DatabaseStorageHealth {
  freeBytes: number
  databaseBytes: number
  walBytes: number
}

export interface CreateProjectInput {
  commandId: string
  deviceId: string
  requestHash: string
  projectId: string
  name: string
  description?: string
  repositoryRootId: string
  repositoryRelativePath: string
  repositoryRealPath: string
  defaultBranch: string
  cityName: string
  rigName: string
  beadPrefix: string
}

interface DeviceRow {
  id: string
  name: string
  token_hash: string
  scopes_json: string
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

interface ProjectRow {
  id: string
  name: string
  description: string | null
  repository_root_id: string
  repository_relative_path: string
  repository_real_path: string
  default_branch: string
  setup_state: ProjectSetupState
  setup_error_code: string | null
  setup_error_message: string | null
  version: number
  created_at: string
  updated_at: string
  city_name: string
  rig_name: string
  bead_prefix: string
  registration_state: RigBindingRecord['registrationState']
  last_reconciled_at: string | null
  last_error_code: string | null
  last_error_message: string | null
}

const PROJECT_SELECT = `
  SELECT p.*, r.city_name, r.rig_name, r.bead_prefix, r.registration_state,
         r.last_reconciled_at, r.last_error_code, r.last_error_message
  FROM projects p JOIN project_rig_bindings r ON r.project_id = p.id
`

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hashCommandRequest(value: unknown): string {
  return hashSecret(JSON.stringify(value))
}

function equalSecretHash(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex')
  const rightBytes = Buffer.from(right, 'hex')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function deviceFromRow(row: DeviceRow): TrustedDevice {
  return {
    id: row.id,
    name: row.name,
    scopes: JSON.parse(row.scopes_json) as OwnerScope[],
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }
}

function projectFromRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repositoryRootId: row.repository_root_id,
    repositoryRelativePath: row.repository_relative_path,
    repositoryRealPath: row.repository_real_path,
    defaultBranch: row.default_branch,
    setupState: row.setup_state,
    setupErrorCode: row.setup_error_code,
    setupErrorMessage: row.setup_error_message,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rig: {
      cityName: row.city_name,
      rigName: row.rig_name,
      beadPrefix: row.bead_prefix,
      registrationState: row.registration_state,
      lastReconciledAt: row.last_reconciled_at,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
    },
  }
}

export class FactoruDatabase {
  readonly connection: Database.Database
  readonly product: ProductStore
  readonly tasks: TaskStore
  readonly agentTools: AgentToolStore
  readonly #now: () => Date
  readonly #filePath: string

  constructor(filePath: string, serverId: ServerId, options: { now?: () => Date } = {}) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.#filePath = filePath
    this.connection = new Database(filePath)
    this.#now = options.now ?? (() => new Date())
    this.connection.pragma('journal_mode = WAL')
    this.connection.pragma('foreign_keys = ON')
    this.connection.pragma('busy_timeout = 5000')
    try {
      applyMigrations(this.connection)
      this.#bindServerIdentity(serverId)
      this.product = new ProductStore(this.connection, this.#now)
      this.tasks = new TaskStore(this.connection, this.#now)
      this.agentTools = new AgentToolStore(this.connection, this.#now)
    } catch (error) {
      this.connection.close()
      throw error
    }
  }

  close(): void {
    this.connection.close()
  }

  checkpoint(): void {
    this.connection.pragma('wal_checkpoint(PASSIVE)')
  }

  storageHealth(): DatabaseStorageHealth {
    const stats = fs.statfsSync(path.dirname(this.#filePath))
    const size = (file: string) => {
      try {
        return fs.statSync(file).size
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
        throw error
      }
    }
    return {
      freeBytes: stats.bavail * stats.bsize,
      databaseBytes: size(this.#filePath),
      walBytes: size(`${this.#filePath}-wal`),
    }
  }

  async backup(destination: string): Promise<void> {
    await this.connection.backup(destination)
  }

  #bindServerIdentity(serverId: ServerId): void {
    const row = this.connection
      .prepare('SELECT server_id FROM server_metadata WHERE singleton = 1')
      .get() as { server_id: string } | undefined
    if (row && row.server_id !== serverId) {
      throw new Error(`Factoru database belongs to ${row.server_id}, not ${serverId}`)
    }
    if (!row) {
      this.connection
        .prepare('INSERT INTO server_metadata(singleton, server_id, created_at) VALUES (1, ?, ?)')
        .run(serverId, this.#now().toISOString())
    }
  }

  createPairingCode(code: string, expiresAt: Date): void {
    this.connection
      .prepare(
        'INSERT INTO pairing_codes(id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(randomUUID(), hashSecret(code), expiresAt.toISOString(), this.#now().toISOString())
  }

  exchangePairingCode(
    code: string,
    deviceName: string,
  ): { device: TrustedDevice; token: string } | null {
    const now = this.#now().toISOString()
    return this.connection.transaction(() => {
      const pairing = this.connection
        .prepare(
          'SELECT id FROM pairing_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?',
        )
        .get(hashSecret(code), now) as { id: string } | undefined
      if (!pairing) return null
      this.connection
        .prepare('UPDATE pairing_codes SET used_at = ? WHERE id = ?')
        .run(now, pairing.id)
      return this.#issueTrustedDevice(deviceName, now)
    })()
  }

  createTrustedDevice(deviceName: string): { device: TrustedDevice; token: string } {
    const now = this.#now().toISOString()
    return this.connection.transaction(() => this.#issueTrustedDevice(deviceName, now))()
  }

  #issueTrustedDevice(deviceName: string, now: string): { device: TrustedDevice; token: string } {
    const token = randomBytes(32).toString('base64url')
    const row: DeviceRow = {
      id: `dev_${randomUUID().replaceAll('-', '')}`,
      name: deviceName,
      token_hash: hashSecret(token),
      scopes_json: JSON.stringify(OWNER_SCOPES),
      created_at: now,
      last_seen_at: now,
      revoked_at: null,
    }
    this.connection
      .prepare(
        `INSERT INTO trusted_devices(id, name, token_hash, scopes_json, created_at, last_seen_at)
         VALUES (@id, @name, @token_hash, @scopes_json, @created_at, @last_seen_at)`,
      )
      .run(row)
    return { device: deviceFromRow(row), token: `${row.id}.${token}` }
  }

  authenticateDevice(rawToken: string): TrustedDevice | null {
    const separator = rawToken.indexOf('.')
    if (separator < 1) return null
    const id = rawToken.slice(0, separator)
    const secret = rawToken.slice(separator + 1)
    const row = this.connection.prepare('SELECT * FROM trusted_devices WHERE id = ?').get(id) as
      DeviceRow | undefined
    if (!row || row.revoked_at || !equalSecretHash(row.token_hash, hashSecret(secret))) return null
    const now = this.#now().toISOString()
    this.connection.prepare('UPDATE trusted_devices SET last_seen_at = ? WHERE id = ?').run(now, id)
    return deviceFromRow({ ...row, last_seen_at: now })
  }

  getActiveDevice(id: string): TrustedDevice | null {
    const row = this.connection.prepare('SELECT * FROM trusted_devices WHERE id = ?').get(id) as
      DeviceRow | undefined
    return row && !row.revoked_at ? deviceFromRow(row) : null
  }

  listDevices(): TrustedDevice[] {
    return (
      this.connection
        .prepare('SELECT * FROM trusted_devices ORDER BY created_at')
        .all() as DeviceRow[]
    ).map(deviceFromRow)
  }

  revokeDevice(id: string): boolean {
    return (
      this.connection
        .prepare('UPDATE trusted_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(this.#now().toISOString(), id).changes === 1
    )
  }

  listProjects(): ProjectRecord[] {
    return (
      this.connection.prepare(`${PROJECT_SELECT} ORDER BY p.created_at`).all() as ProjectRow[]
    ).map(projectFromRow)
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.connection.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(id) as
      ProjectRow | undefined
    return row ? projectFromRow(row) : null
  }

  findProjectByRepository(realPath: string): ProjectRecord | null {
    const row = this.connection
      .prepare(`${PROJECT_SELECT} WHERE p.repository_real_path = ?`)
      .get(realPath) as ProjectRow | undefined
    return row ? projectFromRow(row) : null
  }

  replayProjectCommand(
    commandId: string,
    method: string,
    requestHash: string,
  ): ProjectRecord | null {
    const receipt = this.connection
      .prepare(
        'SELECT method, request_hash, response_json FROM command_receipts WHERE command_id = ?',
      )
      .get(commandId) as { method: string; request_hash: string; response_json: string } | undefined
    if (!receipt) return null
    if (receipt.method !== method || receipt.request_hash !== requestHash)
      throw new Error('command_id_conflict')
    return JSON.parse(receipt.response_json) as ProjectRecord
  }

  replayCommand<T>(commandId: string, method: string, request: unknown): T | undefined {
    const receipt = this.connection
      .prepare(
        'SELECT method, request_hash, response_json FROM command_receipts WHERE command_id = ?',
      )
      .get(commandId) as { method: string; request_hash: string; response_json: string } | undefined
    if (!receipt) return undefined
    if (receipt.method !== method || receipt.request_hash !== hashCommandRequest(request)) {
      throw new Error('command_id_conflict')
    }
    return JSON.parse(receipt.response_json) as T
  }

  recordCommand<T>(
    commandId: string,
    deviceId: string,
    method: string,
    request: unknown,
    response: T,
  ): T {
    const replay = this.replayCommand<T>(commandId, method, request)
    if (replay !== undefined) return replay
    this.connection
      .prepare(
        `INSERT INTO command_receipts(
           command_id, device_id, method, request_hash, response_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        commandId,
        deviceId,
        method,
        hashCommandRequest(request),
        JSON.stringify(response),
        this.#now().toISOString(),
      )
    return response
  }

  executeCommand<T>(
    commandId: string,
    deviceId: string,
    method: string,
    request: unknown,
    action: () => T,
  ): T {
    const replay = this.replayCommand<T>(commandId, method, request)
    if (replay !== undefined) return replay
    return this.connection.transaction(() =>
      this.recordCommand(commandId, deviceId, method, request, action()),
    )()
  }

  createProject(input: CreateProjectInput): ProjectRecord {
    const existing = this.replayProjectCommand(
      input.commandId,
      'projects.create',
      input.requestHash,
    )
    if (existing) return existing

    return this.connection.transaction(() => {
      const now = this.#now().toISOString()
      this.connection
        .prepare(
          `INSERT INTO projects(
             id, name, description, repository_root_id, repository_relative_path,
             repository_real_path, default_branch, setup_state, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'setting_up', ?, ?)`,
        )
        .run(
          input.projectId,
          input.name,
          input.description ?? null,
          input.repositoryRootId,
          input.repositoryRelativePath,
          input.repositoryRealPath,
          input.defaultBranch,
          now,
          now,
        )
      this.connection
        .prepare(
          `INSERT INTO project_rig_bindings(
             project_id, city_name, rig_name, bead_prefix, registration_state
           ) VALUES (?, ?, ?, ?, 'pending')`,
        )
        .run(input.projectId, input.cityName, input.rigName, input.beadPrefix)
      initializeProjectProductModel(this.connection, input.projectId, now)
      const event = this.#appendEvent(
        'project.created',
        input.projectId,
        1,
        { setupState: 'setting_up' },
        input.commandId,
      )
      this.connection
        .prepare(
          `INSERT INTO outbox_items(
             id, kind, aggregate_id, payload_json, status, available_at, created_at, updated_at
           ) VALUES (?, 'project.provision_rig', ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.projectId,
          JSON.stringify({ projectId: input.projectId }),
          now,
          now,
          now,
        )
      const project = this.getProject(input.projectId)!
      this.connection
        .prepare(
          `INSERT INTO command_receipts(
             command_id, device_id, method, request_hash, response_json, created_at
           ) VALUES (?, ?, 'projects.create', ?, ?, ?)`,
        )
        .run(input.commandId, input.deviceId, input.requestHash, JSON.stringify(project), now)
      void event
      return project
    })()
  }

  retryProjectSetup(commandId: string, deviceId: string, projectId: string): ProjectRecord {
    const requestHash = hashSecret(projectId)
    const replay = this.replayProjectCommand(commandId, 'projects.retrySetup', requestHash)
    if (replay) return replay
    return this.connection.transaction(() => {
      const current = this.getProject(projectId)
      if (!current) throw new Error('not_found')
      if (current.setupState !== 'needs_attention') throw new Error('invalid_project_state')
      const now = this.#now().toISOString()
      this.connection
        .prepare(
          `UPDATE projects SET setup_state = 'setting_up', setup_error_code = NULL,
             setup_error_message = NULL, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(now, projectId)
      this.connection
        .prepare(
          `UPDATE project_rig_bindings SET registration_state = 'pending',
             last_error_code = NULL, last_error_message = NULL WHERE project_id = ?`,
        )
        .run(projectId)
      this.connection
        .prepare(
          `INSERT INTO outbox_items(
             id, kind, aggregate_id, payload_json, status, available_at, created_at, updated_at
           ) VALUES (?, 'project.provision_rig', ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(randomUUID(), projectId, JSON.stringify({ projectId }), now, now, now)
      const project = this.getProject(projectId)!
      this.#appendEvent('project.setup_retried', projectId, project.version, {}, commandId)
      this.connection
        .prepare(
          `INSERT INTO command_receipts(
             command_id, device_id, method, request_hash, response_json, created_at
           ) VALUES (?, ?, 'projects.retrySetup', ?, ?, ?)`,
        )
        .run(commandId, deviceId, requestHash, JSON.stringify(project), now)
      return project
    })()
  }

  /** Make work leased by a terminated server immediately eligible after restart. */
  recoverUnfinishedOutbox(): number {
    return this.connection
      .prepare(
        `UPDATE outbox_items SET status = 'pending', lease_expires_at = NULL, updated_at = ?
         WHERE status = 'processing'`,
      )
      .run(this.#now().toISOString()).changes
  }

  claimDueOutbox(limit = 10): Array<{ id: string; projectId: string; attemptCount: number }> {
    return this.connection.transaction(() => {
      const now = this.#now()
      const rows = this.connection
        .prepare(
          `SELECT id, aggregate_id, attempt_count FROM outbox_items
           WHERE kind = 'project.provision_rig'
             AND status IN ('pending', 'processing') AND available_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY created_at LIMIT ?`,
        )
        .all(now.toISOString(), now.toISOString(), limit) as Array<{
        id: string
        aggregate_id: string
        attempt_count: number
      }>
      const lease = new Date(now.getTime() + 30_000).toISOString()
      for (const row of rows) {
        this.connection
          .prepare(
            `UPDATE outbox_items SET status = 'processing', lease_expires_at = ?,
             attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?`,
          )
          .run(lease, now.toISOString(), row.id)
      }
      return rows.map((row) => ({
        id: row.id,
        projectId: row.aggregate_id,
        attemptCount: row.attempt_count + 1,
      }))
    })()
  }

  completeProvisioning(outboxId: string, projectId: string): ProjectRecord {
    return this.connection.transaction(() => {
      const now = this.#now().toISOString()
      this.connection
        .prepare(
          `UPDATE projects SET setup_state = 'ready', setup_error_code = NULL,
             setup_error_message = NULL, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(now, projectId)
      this.connection
        .prepare(
          `UPDATE project_rig_bindings SET registration_state = 'ready',
             last_reconciled_at = ?, last_error_code = NULL, last_error_message = NULL
           WHERE project_id = ?`,
        )
        .run(now, projectId)
      this.connection
        .prepare(
          "UPDATE outbox_items SET status = 'completed', lease_expires_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, outboxId)
      const project = this.getProject(projectId)!
      this.#appendEvent('project.setup_succeeded', projectId, project.version, {}, null)
      return project
    })()
  }

  failProvisioning(
    outboxId: string,
    projectId: string,
    attemptCount: number,
    code: string,
    message: string,
  ): ProjectRecord {
    return this.connection.transaction(() => {
      const now = this.#now()
      if (attemptCount < 6) {
        const delays = [1, 5, 30, 120, 600, 1_800]
        const available = new Date(now.getTime() + delays[attemptCount - 1]! * 1_000).toISOString()
        this.connection
          .prepare(
            `UPDATE outbox_items SET status = 'pending', available_at = ?, lease_expires_at = NULL,
             last_error = ?, updated_at = ? WHERE id = ?`,
          )
          .run(available, message, now.toISOString(), outboxId)
        return this.getProject(projectId)!
      }
      this.connection
        .prepare(
          `UPDATE projects SET setup_state = 'needs_attention', setup_error_code = ?,
             setup_error_message = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(code, message, now.toISOString(), projectId)
      this.connection
        .prepare(
          `UPDATE project_rig_bindings SET registration_state = 'failed', last_reconciled_at = ?,
             last_error_code = ?, last_error_message = ? WHERE project_id = ?`,
        )
        .run(now.toISOString(), code, message, projectId)
      this.connection
        .prepare(
          `UPDATE outbox_items SET status = 'failed', lease_expires_at = NULL,
             last_error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(message, now.toISOString(), outboxId)
      const project = this.getProject(projectId)!
      this.#appendEvent('project.setup_failed', projectId, project.version, { code, message }, null)
      return project
    })()
  }

  eventsAfter(sequence: number, limit = 500): DomainEventRecord[] {
    return (
      this.connection
        .prepare('SELECT * FROM domain_events WHERE sequence > ? ORDER BY sequence LIMIT ?')
        .all(sequence, limit) as Array<{
        sequence: number
        event_id: string
        type: string
        aggregate_id: string
        aggregate_version: number
        payload_json: string
        occurred_at: string
      }>
    ).map((row) => ({
      sequence: row.sequence,
      eventId: row.event_id,
      type: row.type,
      aggregateId: row.aggregate_id,
      aggregateVersion: row.aggregate_version,
      payload: JSON.parse(row.payload_json),
      occurredAt: row.occurred_at,
    }))
  }

  currentSequence(): number {
    return (
      this.connection
        .prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM domain_events')
        .get() as {
        sequence: number
      }
    ).sequence
  }

  #appendEvent(
    type: string,
    aggregateId: string,
    aggregateVersion: number,
    payload: unknown,
    commandId: string | null,
  ): DomainEventRecord {
    const occurredAt = this.#now().toISOString()
    const eventId = randomUUID()
    const result = this.connection
      .prepare(
        `INSERT INTO domain_events(
           event_id, type, aggregate_type, aggregate_id, aggregate_version,
           payload_json, command_id, occurred_at
         ) VALUES (?, ?, 'project', ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        type,
        aggregateId,
        aggregateVersion,
        JSON.stringify(payload),
        commandId,
        occurredAt,
      )
    return {
      sequence: Number(result.lastInsertRowid),
      eventId,
      type,
      aggregateId,
      aggregateVersion,
      payload,
      occurredAt,
    }
  }
}
