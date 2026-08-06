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
} from '@factoru/protocol'
import { DESKTOP_NAME, DESKTOP_VERSION } from './version'
import { normalizeProfileUrl } from './profile-store'
import type { CredentialStore, ProfileStore } from './profile-store'
import { LiveFactoruClient } from './live-client'
import type { ProductSnapshot } from '../shared/product'
import { readLocalEnrollmentFile } from './local-enrollment'

export interface ProductRuntimeOptions {
  readonly localEnrollmentFile?: string
}

export class ProductRuntime {
  readonly #profiles: ProfileStore
  readonly #credentials: CredentialStore
  #live: LiveFactoruClient | null = null
  #listeners = new Set<(snapshot: ProductSnapshot) => void>()
  #snapshot: ProductSnapshot
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #synchronizePromise: Promise<ProductSnapshot> | null = null
  readonly #localEnrollmentFile: string | undefined

  constructor(
    profiles: ProfileStore,
    credentials: CredentialStore,
    options: ProductRuntimeOptions = {},
  ) {
    this.#profiles = profiles
    this.#credentials = credentials
    this.#localEnrollmentFile = options.localEnrollmentFile
    const active = profiles.active()
    this.#snapshot = {
      profiles: this.#publicProfiles(),
      activeServerId: active?.serverId ?? null,
      projects: active?.projects ?? [],
      activeProjectId: active?.selectedProjectId ?? null,
      workspace: active?.selectedProjectId
        ? (active.workspaces[active.selectedProjectId] ?? null)
        : null,
      connected: false,
      cached: active !== null,
      error: null,
    }
  }

  get snapshot(): ProductSnapshot {
    return this.#snapshot
  }

  /** Release live sockets and timers during an application or acceptance restart. */
  dispose(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
    const live = this.#live
    this.#live = null
    live?.close()
    this.#listeners.clear()
  }

  subscribe(listener: (snapshot: ProductSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async pair(urlValue: string, code: string, deviceName: string): Promise<ProductSnapshot> {
    const url = normalizeProfileUrl(urlValue)
    const client = createFactoruClient({
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
    return this.#acceptPairing(url, paired)
  }

  async pairLocal(deviceName: string): Promise<ProductSnapshot> {
    const enrollment = await readLocalEnrollmentFile(this.#localEnrollmentFile)
    const url = normalizeProfileUrl(enrollment.serverUrl)
    const client = createFactoruClient({
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
    return this.#acceptPairing(url, paired)
  }

  async #acceptPairing(url: string, paired: PairingExchangeResponse): Promise<ProductSnapshot> {
    const existing = this.#profiles.list().find((profile) => profile.serverId === paired.serverId)
    this.#credentials.set(paired.serverId, paired.token)
    this.#profiles.save({
      serverId: paired.serverId,
      deviceId: paired.device.id,
      name: existing?.name ?? new URL(url).hostname,
      url,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastConnectedAt: null,
      projects: existing?.projects ?? [],
      selectedProjectId: existing?.selectedProjectId ?? null,
      workspaces: existing?.workspaces ?? {},
      cursor: existing?.cursor ?? 0,
    })
    await this.connect()
    return this.#snapshot
  }

  async activate(serverId: string): Promise<ProductSnapshot> {
    this.#profiles.activate(serverId)
    await this.connect()
    return this.#snapshot
  }
  remove(serverId: string): ProductSnapshot {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
    this.#credentials.delete(serverId)
    this.#profiles.remove(serverId)
    const live = this.#live
    this.#live = null
    live?.close()
    return this.#updateFromStore(false)
  }

  async connect(): Promise<ProductSnapshot> {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
    const previous = this.#live
    this.#live = null
    previous?.close()
    const profile = this.#profiles.active()
    if (!profile) return this.#updateFromStore(false)
    const token = this.#credentials.get(profile.serverId)
    if (!token) return this.#set({ connected: false, cached: true, error: 'Pairing required' })
    try {
      const client = createFactoruClient({
        baseUrl: profile.url,
        clientName: DESKTOP_NAME,
        clientVersion: DESKTOP_VERSION,
      })
      const handshake = await client.handshake()
      if (handshake.response.server.serverId !== profile.serverId)
        throw new Error('This endpoint now identifies as another Factoru Server')
      const live = new LiveFactoruClient({
        baseUrl: profile.url,
        token,
        clientName: DESKTOP_NAME,
        clientVersion: DESKTOP_VERSION,
      })
      this.#live = live
      await live.connect()
      live.onEvent(() => void this.synchronize())
      live.onClose(() => {
        if (this.#live !== live) return
        this.#set({ connected: false, cached: true, error: 'Connection lost; retrying…' })
        if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
        this.#reconnectTimer = setTimeout(() => {
          this.#reconnectTimer = null
          void this.connect()
        }, 2_000)
      })
      await this.synchronize()
      return this.#snapshot
    } catch (error) {
      if (error instanceof FactoruProtocolError && error.code === 'unauthorized') {
        this.#credentials.delete(profile.serverId)
        return this.#set({
          connected: false,
          cached: true,
          error: 'This device was revoked. Pair it again to reconnect.',
        })
      }
      return this.#set({
        connected: false,
        cached: true,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  synchronize(): Promise<ProductSnapshot> {
    if (this.#synchronizePromise) return this.#synchronizePromise
    const tracked = this.#performSynchronize().finally(() => {
      if (this.#synchronizePromise === tracked) this.#synchronizePromise = null
    })
    this.#synchronizePromise = tracked
    return tracked
  }

  async #performSynchronize(): Promise<ProductSnapshot> {
    const profile = this.#profiles.active()
    const live = this.#live
    if (!profile || !live) return this.#snapshot
    const snapshot = projectSnapshotSchema.parse(
      await live.request('projects.subscribe', { afterCursor: profile.cursor }),
    )
    if (this.#live !== live || this.#profiles.active()?.serverId !== profile.serverId) {
      return this.#snapshot
    }
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
    if (this.#live !== live || this.#profiles.active()?.serverId !== profile.serverId) {
      return this.#snapshot
    }
    profile.cursor = snapshot.cursor
    profile.lastConnectedAt = new Date().toISOString()
    this.#profiles.save(profile)
    return this.#updateFromStore(true)
  }

  async request(
    method: Parameters<LiveFactoruClient['request']>[0],
    params: unknown = {},
    commandId?: string,
  ): Promise<unknown> {
    if (!this.#live) throw new Error('Not connected')
    const result = await this.#live.request(method, params, commandId)
    if (method.startsWith('projects.')) await this.synchronize()
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
      if (this.#reconnectTimer) {
        clearTimeout(this.#reconnectTimer)
        this.#reconnectTimer = null
      }
      this.#credentials.delete(active.serverId)
      const live = this.#live
      this.#live = null
      live?.close()
      this.#set({
        connected: false,
        cached: true,
        error: 'This device was revoked. Pair it again to reconnect.',
      })
    }
    return result
  }

  async selectProject(projectId: string): Promise<ProductSnapshot> {
    const profile = this.#profiles.active()
    if (!profile?.projects.some((project) => project.id === projectId)) {
      throw new Error('Project not found in the active server profile')
    }
    profile.selectedProjectId = projectId
    if (this.#live) {
      profile.workspaces[projectId] = workspaceSchema.parse(
        await this.#live.request('workspaces.get', { projectId }),
      )
      profile.lastConnectedAt = new Date().toISOString()
    }
    this.#profiles.save(profile)
    return this.#updateFromStore(this.#live !== null)
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
        }) => profile,
      )
  }
  #updateFromStore(connected: boolean): ProductSnapshot {
    const active = this.#profiles.active()
    return this.#set({
      profiles: this.#publicProfiles(),
      activeServerId: active?.serverId ?? null,
      projects: active?.projects ?? [],
      activeProjectId: active?.selectedProjectId ?? null,
      workspace: active?.selectedProjectId
        ? (active.workspaces[active.selectedProjectId] ?? null)
        : null,
      connected,
      cached: !connected && active !== null,
      error: null,
    })
  }
  #set(patch: Partial<ProductSnapshot>): ProductSnapshot {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener(this.#snapshot)
    return this.#snapshot
  }

  async #refreshWorkspace(projectId: string): Promise<void> {
    const profile = this.#profiles.active()
    if (!profile || !this.#live) return
    profile.workspaces[projectId] = workspaceSchema.parse(
      await this.#live.request('workspaces.get', { projectId }),
    )
    profile.lastConnectedAt = new Date().toISOString()
    this.#profiles.save(profile)
    this.#updateFromStore(true)
  }
}
