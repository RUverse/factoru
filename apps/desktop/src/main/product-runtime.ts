import { randomUUID } from 'node:crypto'
import {
  createFactoruClient,
  CAPABILITY_LOCAL_ENROLLMENT,
  FactoruProtocolError,
  projectSchema,
  projectSnapshotSchema,
  trustedDeviceSchema,
  conversationMessageSchema,
  memoryEntrySchema,
  plannerProbeSchema,
  workerTypeSchema,
  workspaceSchema,
  taskSchema,
  taskMergeProposalSchema,
  executionRunSchema,
  type MemoryEntry,
  type PairingExchangeResponse,
  type PlannerProbe,
  type Project,
  type ProjectPreview,
  type TrustedDevice,
  type WorkerType,
  type Task,
  type TaskMergeProposal,
  type ExecutionRun,
  type FactoruClient,
  type LiveMethod,
} from '@factoru/protocol'
import { DESKTOP_NAME, DESKTOP_VERSION } from './version'
import { normalizeProfileUrl } from './profile-store'
import { type CredentialStore, type ProfileStore, type ServerProfile } from './profile-store'
import { LiveFactoruClient } from './live-client'
import type { ProductSnapshot } from '../shared/product'
import { normalizeFactoryName } from '../shared/factory'
import { readLocalEnrollmentFile } from './local-enrollment'

export interface ProductRuntimeOptions {
  readonly localEnrollmentFile?: string
  readonly createClient?: (
    options: Parameters<typeof createFactoruClient>[0],
  ) => ProductProtocolClient
  readonly createLiveClient?: (
    options: ConstructorParameters<typeof LiveFactoruClient>[0],
  ) => ProductLiveClient
  readonly setTimer?: (handler: () => void, milliseconds: number) => unknown
  readonly clearTimer?: (timer: unknown) => void
  readonly now?: () => Date
}

export interface ProductLiveClient {
  connect(): Promise<void>
  close(): void
  onEvent(listener: (event: unknown) => void): void
  onClose(listener: () => void): void
  request(method: LiveMethod, params?: unknown, commandId?: string): Promise<unknown>
}

type ProductProtocolClient = Pick<FactoruClient, 'handshake' | 'pair' | 'pairLocal'>

type ServerConnectionState = 'connected' | 'connecting' | 'offline' | 'blocked' | 'pairing_required'

interface ServerSession {
  live: ProductLiveClient | null
  connectPromise: Promise<ProductSnapshot> | null
  reconnectTimer: unknown | null
  synchronizePromise: Promise<ProductSnapshot> | null
  state: ServerConnectionState
  error: string | null
  generation: number
}

class BlockedServerConnectionError extends Error {}

interface ResolvedProductRuntimeOptions {
  localEnrollmentFile?: string
  createClient: (options: Parameters<typeof createFactoruClient>[0]) => ProductProtocolClient
  createLiveClient: (
    options: ConstructorParameters<typeof LiveFactoruClient>[0],
  ) => ProductLiveClient
  setTimer: (handler: () => void, milliseconds: number) => unknown
  clearTimer: (timer: unknown) => void
  now: () => Date
}

export class ProductRuntime {
  readonly #profiles: ProfileStore
  readonly #credentials: CredentialStore
  readonly #sessions = new Map<string, ServerSession>()
  #listeners = new Set<(snapshot: ProductSnapshot) => void>()
  #snapshot: ProductSnapshot
  readonly #options: ResolvedProductRuntimeOptions
  #disposed = false

  constructor(
    profiles: ProfileStore,
    credentials: CredentialStore,
    options: ProductRuntimeOptions = {},
  ) {
    this.#profiles = profiles
    this.#credentials = credentials
    this.#options = {
      localEnrollmentFile: options.localEnrollmentFile,
      createClient: options.createClient ?? createFactoruClient,
      createLiveClient: options.createLiveClient ?? ((input) => new LiveFactoruClient(input)),
      setTimer: options.setTimer ?? ((handler, milliseconds) => setTimeout(handler, milliseconds)),
      clearTimer:
        options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)),
      now: options.now ?? (() => new Date()),
    }
    for (const profile of profiles.list()) this.#ensureSession(profile.serverId)
    this.#snapshot = this.#snapshotFromStore()
  }

  get snapshot(): ProductSnapshot {
    return this.#snapshot
  }

  /** Release live sockets and timers during an application or acceptance restart. */
  dispose(): void {
    this.#disposed = true
    for (const session of this.#sessions.values()) {
      session.generation += 1
      if (session.reconnectTimer !== null) {
        this.#options.clearTimer(session.reconnectTimer)
        session.reconnectTimer = null
      }
      const live = session.live
      session.live = null
      live?.close()
    }
    this.#sessions.clear()
    this.#listeners.clear()
  }

  subscribe(listener: (snapshot: ProductSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async pair(
    urlValue: string,
    code: string,
    deviceName: string,
    factoryName: string,
  ): Promise<ProductSnapshot> {
    const url = normalizeProfileUrl(urlValue)
    const name = normalizeFactoryName(factoryName)
    const client = this.#options.createClient({
      baseUrl: url,
      clientName: DESKTOP_NAME,
      clientVersion: DESKTOP_VERSION,
    })
    const handshake = await client.handshake()
    if (!handshake.compatibility.compatible)
      throw new Error(handshake.compatibility.incompatibility.message)
    const endpointProfile = this.#profiles.list().find((profile) => profile.url === url)
    if (endpointProfile && endpointProfile.serverId !== handshake.response.server.serverId) {
      throw new Error('This known endpoint now identifies as another Factoru Server')
    }
    const paired = await client.pair(code, deviceName)
    if (paired.serverId !== handshake.response.server.serverId)
      throw new Error('Server identity changed during pairing')
    return this.#acceptPairing(url, paired, name)
  }

  async pairLocal(deviceName: string): Promise<ProductSnapshot> {
    const enrollment = await readLocalEnrollmentFile(this.#options.localEnrollmentFile)
    const url = normalizeProfileUrl(enrollment.serverUrl)
    const client = this.#options.createClient({
      baseUrl: url,
      clientName: DESKTOP_NAME,
      clientVersion: DESKTOP_VERSION,
    })
    const handshake = await client.handshake()
    if (!handshake.compatibility.compatible)
      throw new Error(handshake.compatibility.incompatibility.message)
    if (handshake.response.server.serverId !== enrollment.serverId) {
      throw new Error('The local server identity does not match its enrollment file')
    }
    if (!handshake.response.server.capabilities.includes(CAPABILITY_LOCAL_ENROLLMENT)) {
      throw new Error('This local Factoru Server does not support one-click connection')
    }
    const paired = await client.pairLocal(enrollment.proof, deviceName)
    if (paired.serverId !== enrollment.serverId) {
      throw new Error('Server identity changed during local enrollment')
    }
    return this.#acceptPairing(url, paired, 'Local Factory')
  }

  async #acceptPairing(
    url: string,
    paired: PairingExchangeResponse,
    factoryName: string,
  ): Promise<ProductSnapshot> {
    const existing = this.#profiles.get(paired.serverId)
    this.#credentials.set(paired.serverId, paired.token)
    this.#profiles.save({
      serverId: paired.serverId,
      deviceId: paired.device.id,
      name: existing?.name ?? factoryName,
      url,
      createdAt: existing?.createdAt ?? this.#options.now().toISOString(),
      lastConnectedAt: null,
      projects: existing?.projects ?? [],
      selectedProjectId: existing?.selectedProjectId ?? null,
      workspaces: existing?.workspaces ?? {},
      cursor: existing?.cursor ?? 0,
    })
    await this.#connectProfile(paired.serverId)
    return this.#snapshot
  }

  async activate(serverId: string): Promise<ProductSnapshot> {
    this.#profiles.activate(serverId)
    const session = this.#ensureSession(serverId)
    this.#updateFromStore()
    if (session.state !== 'connected' && session.state !== 'connecting') {
      await this.#connectProfile(serverId)
    }
    return this.#snapshot
  }

  rename(serverId: string, name: string): ProductSnapshot {
    this.#profiles.rename(serverId, name)
    return this.#updateFromStore()
  }

  remove(serverId: string): ProductSnapshot {
    this.#credentials.delete(serverId)
    this.#profiles.remove(serverId)
    this.#closeSession(serverId)
    this.#sessions.delete(serverId)
    return this.#updateFromStore()
  }

  async connect(serverId = this.#profiles.activeServerId): Promise<ProductSnapshot> {
    if (!serverId || !this.#profiles.get(serverId)) return this.#updateFromStore()
    return this.#connectProfile(serverId)
  }

  async connectAll(): Promise<ProductSnapshot> {
    await Promise.all(
      this.#profiles.list().map((profile) => this.#connectProfile(profile.serverId)),
    )
    return this.#snapshot
  }

  #connectProfile(serverId: string): Promise<ProductSnapshot> {
    if (this.#disposed) return Promise.resolve(this.#snapshot)
    const profile = this.#profiles.get(serverId)
    if (!profile) return Promise.resolve(this.#snapshot)
    const session = this.#ensureSession(serverId)
    if (session.connectPromise) return session.connectPromise
    const tracked = this.#performConnectProfile(profile, session).finally(() => {
      if (session.connectPromise === tracked) session.connectPromise = null
    })
    session.connectPromise = tracked
    return tracked
  }

  async #performConnectProfile(
    profile: ServerProfile,
    session: ServerSession,
  ): Promise<ProductSnapshot> {
    const serverId = profile.serverId
    this.#closeSession(serverId)
    const generation = session.generation
    const token = this.#credentials.get(profile.serverId)
    if (!token) {
      session.state = 'pairing_required'
      session.error = 'Pairing required'
      return this.#updateFromStore()
    }
    session.state = 'connecting'
    session.error = null
    this.#updateFromStore()
    try {
      const client = this.#options.createClient({
        baseUrl: profile.url,
        clientName: DESKTOP_NAME,
        clientVersion: DESKTOP_VERSION,
      })
      const handshake = await client.handshake()
      if (this.#disposed || session.generation !== generation || !this.#profiles.get(serverId))
        return this.#snapshot
      if (!handshake.compatibility.compatible) {
        session.state = 'blocked'
        session.error = handshake.compatibility.incompatibility.message
        return this.#updateFromStore()
      }
      if (handshake.response.server.serverId !== profile.serverId)
        throw new BlockedServerConnectionError(
          'This endpoint now identifies as another Factoru Server',
        )
      const live = this.#options.createLiveClient({
        baseUrl: profile.url,
        token,
        clientName: DESKTOP_NAME,
        clientVersion: DESKTOP_VERSION,
      })
      session.live = live
      await live.connect()
      if (this.#disposed || session.generation !== generation || !this.#profiles.get(serverId)) {
        if (session.live === live) session.live = null
        live.close()
        return this.#snapshot
      }
      live.onEvent(() => void this.synchronize(serverId))
      live.onClose(() => {
        if (session.live !== live) return
        session.live = null
        session.state = 'offline'
        session.error = 'Connection lost; retrying…'
        this.#updateFromStore()
        this.#scheduleReconnect(serverId)
      })
      await this.synchronize(serverId)
      if (session.live === live) {
        session.state = 'connected'
        session.error = null
        this.#updateFromStore()
      }
      return this.#snapshot
    } catch (error) {
      if (this.#disposed || session.generation !== generation || !this.#profiles.get(serverId))
        return this.#snapshot
      if (session.live === null && session.reconnectTimer !== null) return this.#snapshot
      const live = session.live
      session.live = null
      live?.close()
      if (error instanceof FactoruProtocolError && error.code === 'unauthorized') {
        this.#credentials.delete(profile.serverId)
        session.state = 'pairing_required'
        session.error = 'This device was revoked. Pair it again to reconnect.'
        return this.#updateFromStore()
      }
      session.state =
        error instanceof BlockedServerConnectionError || error instanceof FactoruProtocolError
          ? error instanceof FactoruProtocolError &&
            ['transport_error', 'timeout', 'unavailable'].includes(error.code)
            ? 'offline'
            : 'blocked'
          : 'offline'
      session.error = error instanceof Error ? error.message : String(error)
      const snapshot = this.#updateFromStore()
      if (session.state === 'offline') this.#scheduleReconnect(serverId)
      return snapshot
    }
  }

  synchronize(serverId = this.#profiles.activeServerId): Promise<ProductSnapshot> {
    if (!serverId) return Promise.resolve(this.#snapshot)
    const session = this.#ensureSession(serverId)
    if (session.synchronizePromise) return session.synchronizePromise
    const tracked = this.#performSynchronize(serverId).finally(() => {
      if (session.synchronizePromise === tracked) session.synchronizePromise = null
    })
    session.synchronizePromise = tracked
    return tracked
  }

  async #performSynchronize(serverId: string): Promise<ProductSnapshot> {
    const profile = this.#profiles.get(serverId)
    const session = this.#sessions.get(serverId)
    const live = session?.live
    if (!profile || !live) return this.#snapshot
    const snapshot = projectSnapshotSchema.parse(
      await live.request('projects.subscribe', { afterCursor: profile.cursor }),
    )
    if (session.live !== live) return this.#snapshot
    profile.projects = snapshot.projects
    if (
      !profile.selectedProjectId ||
      !profile.projects.some((project) => project.id === profile.selectedProjectId)
    ) {
      profile.selectedProjectId = profile.projects[0]?.id ?? null
    }
    if (profile.selectedProjectId) {
      profile.workspaces[profile.selectedProjectId] = workspaceSchema.parse(
        await live.request('workspaces.get', { projectId: profile.selectedProjectId }),
      )
    }
    if (session.live !== live) return this.#snapshot
    profile.cursor = snapshot.cursor
    profile.lastConnectedAt = this.#options.now().toISOString()
    this.#profiles.update(profile)
    return this.#updateFromStore()
  }

  async request(method: LiveMethod, params: unknown = {}, commandId?: string): Promise<unknown> {
    const profile = this.#profiles.active()
    const live = profile ? this.#sessions.get(profile.serverId)?.live : null
    if (!profile || !live) throw new Error('Not connected')
    const result = await live.request(method, params, commandId)
    if (method.startsWith('projects.')) await this.synchronize(profile.serverId)
    return result
  }

  async preview(
    rootId: string,
    relativePath: string,
    defaultBranch?: string,
  ): Promise<ProjectPreview> {
    return (await this.request('projects.previewCreate', {
      rootId,
      relativePath,
      defaultBranch,
    })) as ProjectPreview
  }
  async previewPath(absolutePath: string): Promise<ProjectPreview> {
    return (await this.request('repositories.previewPath', { absolutePath })) as ProjectPreview
  }
  async create(params: unknown): Promise<Project> {
    const project = projectSchema.parse(
      await this.request('projects.create', params, `cmd_${randomUUID()}`),
    )
    await this.selectProject(project.id)
    return project
  }
  async devices(): Promise<TrustedDevice[]> {
    return trustedDeviceSchema.array().parse(await this.request('devices.list'))
  }
  async revoke(deviceId: string): Promise<unknown> {
    const active = this.#profiles.active()
    const result = await this.request('devices.revoke', {
      deviceId,
      confirmSelf: active?.deviceId === deviceId,
    })
    if (active?.deviceId === deviceId) {
      this.#credentials.delete(active.serverId)
      this.#closeSession(active.serverId)
      const session = this.#ensureSession(active.serverId)
      session.state = 'pairing_required'
      session.error = 'This device was revoked. Pair it again to reconnect.'
      this.#updateFromStore()
    }
    return result
  }

  async selectProject(projectId: string): Promise<ProductSnapshot> {
    const profile = this.#profiles.active()
    if (!profile?.projects.some((project) => project.id === projectId)) {
      throw new Error('Project not found in the active server profile')
    }
    profile.selectedProjectId = projectId
    const live = this.#sessions.get(profile.serverId)?.live
    if (live) {
      profile.workspaces[projectId] = workspaceSchema.parse(
        await live.request('workspaces.get', { projectId }),
      )
      profile.lastConnectedAt = this.#options.now().toISOString()
    }
    this.#profiles.update(profile)
    return this.#updateFromStore()
  }

  async sendMessage(projectId: string, text: string) {
    const result = conversationMessageSchema.parse(
      await this.request('conversations.send', { projectId, text }, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(projectId)
    return result
  }

  async updateModel(input: {
    projectId: string
    workerTypeKind: WorkerType['kind']
    slot: WorkerType['modelBindings'][number]['slot']
    provider: string | null
    model: string | null
  }): Promise<WorkerType> {
    const result = workerTypeSchema.parse(
      await this.request('workers.updateModelBinding', input, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(input.projectId)
    return result
  }

  async addMemory(input: {
    projectId: string
    scope: MemoryEntry['scope']
    workerTypeKind?: WorkerType['kind']
    content: string
    provenanceRef: string
    supersedesId?: string
  }): Promise<MemoryEntry> {
    const result = memoryEntrySchema.parse(
      await this.request('memory.add', input, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(input.projectId)
    return result
  }

  async startPlanner(projectId: string): Promise<PlannerProbe> {
    const result = plannerProbeSchema.parse(
      await this.request('planner.start', { projectId }, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(projectId)
    return result
  }

  async cancelPlanner(projectId: string, plannerProbeId: string): Promise<PlannerProbe> {
    const result = plannerProbeSchema.parse(
      await this.request('planner.cancel', { projectId, plannerProbeId }, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(projectId)
    return result
  }

  async createTask(input: {
    projectId: string
    title: string
    description?: string
    status: 'backlog' | 'queue'
  }): Promise<Task> {
    const result = taskSchema.parse(
      await this.request('tasks.create', input, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(input.projectId)
    return result
  }

  async updateTask(input: {
    projectId: string
    taskId: string
    title?: string
    description?: string
    priority?: number
  }): Promise<Task> {
    const result = taskSchema.parse(
      await this.request('tasks.update', input, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(input.projectId)
    return result
  }

  async moveTask(input: {
    projectId: string
    taskId: string
    status: Task['status']
    needsYouAction?: NonNullable<Task['needsYouAction']>
    needsYouMessage?: string
  }): Promise<Task> {
    const result = taskSchema.parse(await this.request('tasks.move', input, `cmd_${randomUUID()}`))
    await this.#refreshWorkspace(input.projectId)
    return result
  }

  async resolveTask(input: {
    projectId: string
    taskId: string
    resolution: Exclude<NonNullable<Task['resolution']>, 'superseded'>
    summary: string
  }): Promise<Task> {
    const result = taskSchema.parse(
      await this.request('tasks.resolve', input, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(input.projectId)
    return result
  }

  async decideTaskMerge(input: {
    projectId: string
    proposalId: string
    decision: 'accept' | 'reject'
  }): Promise<TaskMergeProposal> {
    const result = taskMergeProposalSchema.parse(
      await this.request('tasks.decideMerge', input, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(input.projectId)
    return result
  }

  async cancelRun(projectId: string, runId: string): Promise<ExecutionRun> {
    const result = executionRunSchema.parse(
      await this.request('runs.cancel', { projectId, runId }, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(projectId)
    return result
  }

  async retryRun(projectId: string, runId: string): Promise<Task> {
    const result = taskSchema.parse(
      await this.request('runs.retry', { projectId, runId }, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(projectId)
    return result
  }

  async requestRunChanges(projectId: string, runId: string, feedback: string): Promise<Task> {
    const result = taskSchema.parse(
      await this.request(
        'runs.requestChanges',
        { projectId, runId, feedback },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(projectId)
    return result
  }

  async approveRun(projectId: string, runId: string, summary: string): Promise<Task> {
    const result = taskSchema.parse(
      await this.request('runs.approve', { projectId, runId, summary }, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(projectId)
    return result
  }

  async archiveRun(projectId: string, runId: string): Promise<ExecutionRun> {
    const result = executionRunSchema.parse(
      await this.request('runs.archive', { projectId, runId }, `cmd_${randomUUID()}`),
    )
    await this.#refreshWorkspace(projectId)
    return result
  }

  #publicProfiles() {
    return this.#profiles
      .list()
      .map(
        ({
          projects: _projects,
          selectedProjectId: _selectedProjectId,
          workspaces: _workspaces,
          cursor: _cursor,
          ...profile
        }) => {
          const session = this.#ensureSession(profile.serverId)
          return {
            ...profile,
            connectionState: session.state,
            error: session.error,
          }
        },
      )
  }

  #snapshotFromStore(): ProductSnapshot {
    const active = this.#profiles.active()
    const activeSession = active ? this.#ensureSession(active.serverId) : null
    const connected = activeSession?.state === 'connected'
    return {
      profiles: this.#publicProfiles(),
      activeServerId: active?.serverId ?? null,
      projects: active?.projects ?? [],
      activeProjectId: active?.selectedProjectId ?? null,
      workspace: active?.selectedProjectId
        ? (active.workspaces[active.selectedProjectId] ?? null)
        : null,
      connected,
      cached: !connected && active !== null,
      error: activeSession?.error ?? null,
    }
  }

  #updateFromStore(): ProductSnapshot {
    return this.#set(this.#snapshotFromStore())
  }

  #set(patch: Partial<ProductSnapshot>): ProductSnapshot {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener(this.#snapshot)
    return this.#snapshot
  }

  async #refreshWorkspace(projectId: string): Promise<void> {
    const profile = this.#profiles.active()
    const live = profile ? this.#sessions.get(profile.serverId)?.live : null
    if (!profile || !live) return
    profile.workspaces[projectId] = workspaceSchema.parse(
      await live.request('workspaces.get', { projectId }),
    )
    profile.lastConnectedAt = this.#options.now().toISOString()
    this.#profiles.update(profile)
    this.#updateFromStore()
  }

  #ensureSession(serverId: string): ServerSession {
    const existing = this.#sessions.get(serverId)
    if (existing) return existing
    const session: ServerSession = {
      live: null,
      connectPromise: null,
      reconnectTimer: null,
      synchronizePromise: null,
      state: this.#credentials.get(serverId) ? 'offline' : 'pairing_required',
      error: this.#credentials.get(serverId) ? null : 'Pairing required',
      generation: 0,
    }
    this.#sessions.set(serverId, session)
    return session
  }

  #closeSession(serverId: string): void {
    const session = this.#sessions.get(serverId)
    if (!session) return
    session.generation += 1
    if (session.reconnectTimer !== null) {
      this.#options.clearTimer(session.reconnectTimer)
      session.reconnectTimer = null
    }
    const live = session.live
    session.live = null
    live?.close()
  }

  #scheduleReconnect(serverId: string): void {
    const session = this.#sessions.get(serverId)
    if (!session || session.reconnectTimer !== null || !this.#profiles.get(serverId)) return
    session.reconnectTimer = this.#options.setTimer(() => {
      session.reconnectTimer = null
      void this.#connectProfile(serverId)
    }, 2_000)
  }
}
