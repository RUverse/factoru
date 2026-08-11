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
  repositoryAccessCheckSchema,
  repositoryAccessErrorCodeSchema,
  type MemoryEntry,
  type PairingExchangeResponse,
  type PlannerProbe,
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
import { LiveFactoruClient, LiveRequestError } from './live-client'
import type { ProductSnapshot, ProjectRef, RepositoryAccessOutcome } from '../shared/product'
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
  #initialized = false

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
    await this.#acceptPairing(url, paired, name, 'remote')
    this.#profiles.completeRemoteFactoryIntro()
    return this.#updateFromStore()
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
    return this.#acceptPairing(url, paired, 'Local Factory', 'local')
  }

  async #acceptPairing(
    url: string,
    paired: PairingExchangeResponse,
    factoryName: string,
    kind: ServerProfile['kind'],
  ): Promise<ProductSnapshot> {
    const existing = this.#profiles.get(paired.serverId)
    const existingLocal = this.#profiles.list().find((profile) => profile.kind === 'local')
    if (kind === 'local' && existingLocal && existingLocal.serverId !== paired.serverId) {
      throw new Error('Local Factory identifies as a different server; recovery is required')
    }
    this.#credentials.set(paired.serverId, paired.token)
    this.#profiles.save({
      serverId: paired.serverId,
      deviceId: paired.device.id,
      kind: kind === 'local' ? 'local' : (existing?.kind ?? 'remote'),
      name: existing?.name ?? factoryName,
      url,
      createdAt: existing?.createdAt ?? this.#options.now().toISOString(),
      lastConnectedAt: null,
      projects: existing?.projects ?? [],
      workspaces: existing?.workspaces ?? {},
      cursor: existing?.cursor ?? 0,
    })
    if (kind === 'local') this.#profiles.adoptLocal(paired.serverId, url)
    await this.#connectProfile(paired.serverId)
    return this.#snapshot
  }

  rename(serverId: string, name: string): ProductSnapshot {
    this.#profiles.rename(serverId, name)
    return this.#updateFromStore()
  }

  remove(serverId: string): ProductSnapshot {
    const profile = this.#profiles.get(serverId)
    if (profile?.kind === 'local') throw new Error('Local Factory cannot be forgotten')
    this.#credentials.delete(serverId)
    this.#profiles.remove(serverId)
    this.#closeSession(serverId)
    this.#sessions.delete(serverId)
    this.#selectFallbackProject()
    return this.#updateFromStore()
  }

  completeRemoteFactoryIntro(): ProductSnapshot {
    this.#profiles.completeRemoteFactoryIntro()
    return this.#updateFromStore()
  }

  async connect(serverId: string): Promise<ProductSnapshot> {
    if (!serverId || !this.#profiles.get(serverId)) return this.#updateFromStore()
    return this.#connectProfile(serverId)
  }

  async initialize(deviceName: string): Promise<ProductSnapshot> {
    try {
      await this.#autoEnrollLocal(deviceName)
      await this.connectAll()
    } finally {
      this.#initialized = true
      this.#updateFromStore()
    }
    return this.#snapshot
  }

  async connectAll(): Promise<ProductSnapshot> {
    await this.#reconcileLocalProfile()
    await Promise.all(
      this.#profiles.list().map((profile) => this.#connectProfile(profile.serverId)),
    )
    if (!this.#profiles.activeProjectRef) {
      this.#selectFallbackProject()
      const active = this.#profiles.activeProjectRef
      if (active) await this.selectProject(active)
    }
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

  synchronize(serverId: string): Promise<ProductSnapshot> {
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
    const active = this.#profiles.activeProjectRef
    if (
      active?.factoryId === serverId &&
      profile.projects.some((item) => item.id === active.projectId)
    ) {
      profile.workspaces[active.projectId] = workspaceSchema.parse(
        await live.request('workspaces.get', { projectId: active.projectId }),
      )
    }
    if (session.live !== live) return this.#snapshot
    profile.cursor = snapshot.cursor
    profile.lastConnectedAt = this.#options.now().toISOString()
    this.#profiles.update(profile)
    if (
      active?.factoryId === serverId &&
      !profile.projects.some((item) => item.id === active.projectId)
    ) {
      this.#profiles.selectProject(null)
      this.#selectFallbackProject()
    }
    return this.#updateFromStore()
  }

  async request(
    factoryId: string,
    method: LiveMethod,
    params: unknown = {},
    commandId?: string,
  ): Promise<unknown> {
    const profile = this.#profiles.get(factoryId)
    const live = profile ? this.#sessions.get(factoryId)?.live : null
    if (!profile || !live) throw new Error('Not connected')
    const result = await live.request(method, params, commandId)
    if (method.startsWith('projects.')) await this.synchronize(factoryId)
    return result
  }

  async preview(
    factoryId: string,
    rootId: string,
    relativePath: string,
    defaultBranch?: string,
  ): Promise<ProjectPreview> {
    return (await this.request(factoryId, 'projects.previewCreate', {
      rootId,
      relativePath,
      defaultBranch,
    })) as ProjectPreview
  }
  async previewPath(factoryId: string, absolutePath: string): Promise<ProjectPreview> {
    const profile = this.#profiles.get(factoryId)
    if (profile?.kind !== 'local') {
      throw new Error('Native folder selection is available only for Local Factory')
    }
    return (await this.request(factoryId, 'repositories.previewPath', {
      absolutePath,
    })) as ProjectPreview
  }
  async checkRepositoryAccess(factoryId: string, url: string): Promise<RepositoryAccessOutcome> {
    try {
      return {
        ok: true,
        result: repositoryAccessCheckSchema.parse(
          await this.request(factoryId, 'repositories.checkRemoteAccess', { url }),
        ),
      }
    } catch (error) {
      if (error instanceof LiveRequestError) {
        const code = repositoryAccessErrorCodeSchema.safeParse(error.code)
        if (code.success) {
          return { ok: false, error: { code: code.data, message: error.message } }
        }
      }
      return {
        ok: false,
        error: {
          code: 'unavailable',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }
  async create(factoryId: string, params: unknown): Promise<ProductSnapshot> {
    const project = projectSchema.parse(
      await this.request(factoryId, 'projects.create', params, `cmd_${randomUUID()}`),
    )
    return this.selectProject({ factoryId, projectId: project.id })
  }
  async devices(factoryId: string): Promise<TrustedDevice[]> {
    return trustedDeviceSchema.array().parse(await this.request(factoryId, 'devices.list'))
  }
  async revoke(factoryId: string, deviceId: string): Promise<unknown> {
    const profile = this.#profiles.get(factoryId)
    if (!profile) throw new Error('Factory not found')
    const result = await this.request(factoryId, 'devices.revoke', {
      deviceId,
      confirmSelf: profile.deviceId === deviceId,
    })
    if (profile.deviceId === deviceId) {
      this.#credentials.delete(profile.serverId)
      this.#closeSession(profile.serverId)
      const session = this.#ensureSession(profile.serverId)
      session.state = 'pairing_required'
      session.error = 'This device was revoked. Pair it again to reconnect.'
      this.#updateFromStore()
    }
    return result
  }

  async selectProject(reference: ProjectRef): Promise<ProductSnapshot> {
    const profile = this.#profiles.get(reference.factoryId)
    if (!profile?.projects.some((project) => project.id === reference.projectId)) {
      throw new Error('Project not found in its home factory')
    }
    this.#profiles.selectProject(reference)
    const live = this.#sessions.get(profile.serverId)?.live
    if (live) {
      profile.workspaces[reference.projectId] = workspaceSchema.parse(
        await live.request('workspaces.get', { projectId: reference.projectId }),
      )
      profile.lastConnectedAt = this.#options.now().toISOString()
    }
    this.#profiles.update(profile)
    return this.#updateFromStore()
  }

  async sendMessage(project: ProjectRef, text: string) {
    const result = conversationMessageSchema.parse(
      await this.request(
        project.factoryId,
        'conversations.send',
        { projectId: project.projectId, text },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async updateModel(input: {
    project: ProjectRef
    workerTypeKind: WorkerType['kind']
    slot: WorkerType['modelBindings'][number]['slot']
    provider: string | null
    model: string | null
  }): Promise<WorkerType> {
    const { project, ...values } = input
    const result = workerTypeSchema.parse(
      await this.request(
        project.factoryId,
        'workers.updateModelBinding',
        { ...values, projectId: project.projectId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async addMemory(input: {
    project: ProjectRef
    scope: MemoryEntry['scope']
    workerTypeKind?: WorkerType['kind']
    content: string
    provenanceRef: string
    supersedesId?: string
  }): Promise<MemoryEntry> {
    const { project, ...values } = input
    const result = memoryEntrySchema.parse(
      await this.request(
        project.factoryId,
        'memory.add',
        { ...values, projectId: project.projectId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async startPlanner(project: ProjectRef): Promise<PlannerProbe> {
    const result = plannerProbeSchema.parse(
      await this.request(
        project.factoryId,
        'planner.start',
        { projectId: project.projectId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async cancelPlanner(project: ProjectRef, plannerProbeId: string): Promise<PlannerProbe> {
    const result = plannerProbeSchema.parse(
      await this.request(
        project.factoryId,
        'planner.cancel',
        { projectId: project.projectId, plannerProbeId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async createTask(input: {
    project: ProjectRef
    title: string
    description?: string
    status: 'backlog' | 'queue'
  }): Promise<Task> {
    const { project, ...values } = input
    const result = taskSchema.parse(
      await this.request(
        project.factoryId,
        'tasks.create',
        { ...values, projectId: project.projectId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async updateTask(input: {
    project: ProjectRef
    taskId: string
    title?: string
    description?: string
    priority?: number
  }): Promise<Task> {
    const { project, ...values } = input
    const result = taskSchema.parse(
      await this.request(
        project.factoryId,
        'tasks.update',
        { ...values, projectId: project.projectId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async moveTask(input: {
    project: ProjectRef
    taskId: string
    status: Task['status']
    needsYouAction?: NonNullable<Task['needsYouAction']>
    needsYouMessage?: string
  }): Promise<Task> {
    const { project, ...values } = input
    const result = taskSchema.parse(
      await this.request(
        project.factoryId,
        'tasks.move',
        { ...values, projectId: project.projectId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async resolveTask(input: {
    project: ProjectRef
    taskId: string
    resolution: Exclude<NonNullable<Task['resolution']>, 'superseded'>
    summary: string
  }): Promise<Task> {
    const { project, ...values } = input
    const result = taskSchema.parse(
      await this.request(
        project.factoryId,
        'tasks.resolve',
        { ...values, projectId: project.projectId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async decideTaskMerge(input: {
    project: ProjectRef
    proposalId: string
    decision: 'accept' | 'reject'
  }): Promise<TaskMergeProposal> {
    const { project, ...values } = input
    const result = taskMergeProposalSchema.parse(
      await this.request(
        project.factoryId,
        'tasks.decideMerge',
        { ...values, projectId: project.projectId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async cancelRun(project: ProjectRef, runId: string): Promise<ExecutionRun> {
    const result = executionRunSchema.parse(
      await this.request(
        project.factoryId,
        'runs.cancel',
        { projectId: project.projectId, runId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async retryRun(project: ProjectRef, runId: string): Promise<Task> {
    const result = taskSchema.parse(
      await this.request(
        project.factoryId,
        'runs.retry',
        { projectId: project.projectId, runId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async requestRunChanges(project: ProjectRef, runId: string, feedback: string): Promise<Task> {
    const result = taskSchema.parse(
      await this.request(
        project.factoryId,
        'runs.requestChanges',
        { projectId: project.projectId, runId, feedback },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async approveRun(project: ProjectRef, runId: string, summary: string): Promise<Task> {
    const result = taskSchema.parse(
      await this.request(
        project.factoryId,
        'runs.approve',
        { projectId: project.projectId, runId, summary },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  async archiveRun(project: ProjectRef, runId: string): Promise<ExecutionRun> {
    const result = executionRunSchema.parse(
      await this.request(
        project.factoryId,
        'runs.archive',
        { projectId: project.projectId, runId },
        `cmd_${randomUUID()}`,
      ),
    )
    await this.#refreshWorkspace(project)
    return result
  }

  #publicProfiles() {
    return this.#profiles
      .list()
      .sort((left, right) => Number(right.kind === 'local') - Number(left.kind === 'local'))
      .map(({ projects: _projects, workspaces: _workspaces, cursor: _cursor, ...profile }) => {
        const session = this.#ensureSession(profile.serverId)
        return {
          ...profile,
          connectionState: session.state,
          error: session.error,
        }
      })
  }

  async #reconcileLocalProfile(): Promise<void> {
    try {
      const enrollment = await readLocalEnrollmentFile(this.#options.localEnrollmentFile)
      const profile = this.#profiles.adoptLocal(
        enrollment.serverId,
        normalizeProfileUrl(enrollment.serverUrl),
      )
      if (profile) this.#updateFromStore()
    } catch {
      // A missing or invalid enrollment descriptor must not hide saved remote factories.
    }
  }

  async #autoEnrollLocal(deviceName: string): Promise<void> {
    try {
      const enrollment = await readLocalEnrollmentFile(this.#options.localEnrollmentFile)
      const known = this.#profiles.get(enrollment.serverId)
      if (known) {
        this.#profiles.adoptLocal(enrollment.serverId, normalizeProfileUrl(enrollment.serverUrl))
        return
      }
      if (this.#profiles.list().some((profile) => profile.kind === 'local')) return
      await this.pairLocal(deviceName)
    } catch {
      // Local availability is optional; the renderer keeps a recoverable built-in entry.
    }
  }

  #snapshotFromStore(): ProductSnapshot {
    const profiles = this.#publicProfiles()
    const activeRef = this.#profiles.activeProjectRef
    const active = activeRef ? this.#profiles.get(activeRef.factoryId) : null
    const activeSession = active ? this.#ensureSession(active.serverId) : null
    const connected = activeSession?.state === 'connected'
    return {
      initialized: this.#initialized,
      profiles,
      projects: this.#profiles.list().flatMap((profile) => {
        const summary = profiles.find((candidate) => candidate.serverId === profile.serverId)
        if (!summary) return []
        return profile.projects.map((project) => ({
          ref: { factoryId: profile.serverId, projectId: project.id },
          project,
          factoryName: summary.name,
          factoryKind: summary.kind,
          factoryConnectionState: summary.connectionState,
        }))
      }),
      activeProjectRef: activeRef,
      workspace: activeRef && active ? (active.workspaces[activeRef.projectId] ?? null) : null,
      connected,
      cached: !connected && active !== null,
      error: activeSession?.error ?? null,
      remoteFactoryIntroComplete: this.#profiles.remoteFactoryIntroComplete,
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

  async #refreshWorkspace(project: ProjectRef): Promise<void> {
    const profile = this.#profiles.get(project.factoryId)
    const live = profile ? this.#sessions.get(project.factoryId)?.live : null
    if (!profile || !live) return
    profile.workspaces[project.projectId] = workspaceSchema.parse(
      await live.request('workspaces.get', { projectId: project.projectId }),
    )
    profile.lastConnectedAt = this.#options.now().toISOString()
    this.#profiles.update(profile)
    this.#updateFromStore()
  }

  #selectFallbackProject(): void {
    if (this.#profiles.activeProjectRef) return
    const profiles = this.#profiles
      .list()
      .sort((left, right) => Number(right.kind === 'local') - Number(left.kind === 'local'))
    for (const profile of profiles) {
      const project = profile.projects[0]
      if (!project) continue
      this.#profiles.selectProject({ factoryId: profile.serverId, projectId: project.id })
      return
    }
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
