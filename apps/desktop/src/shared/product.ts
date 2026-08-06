import type {
  ConversationMessage,
  MemoryEntry,
  PlannerProbe,
  Project,
  ProjectPreview,
  TrustedDevice,
  WorkerType,
  Workspace,
} from '@factoru/protocol'

export interface ServerProfileSummary {
  serverId: string
  deviceId: string
  name: string
  url: string
  createdAt: string
  lastConnectedAt: string | null
}

export interface ProductSnapshot {
  profiles: ServerProfileSummary[]
  activeServerId: string | null
  projects: Project[]
  activeProjectId: string | null
  workspace: Workspace | null
  connected: boolean
  cached: boolean
  error: string | null
}

export const IPC_PRODUCT_GET = 'factoru:product:get'
export const IPC_PRODUCT_PAIR = 'factoru:product:pair'
export const IPC_PRODUCT_ACTIVATE = 'factoru:product:activate'
export const IPC_PRODUCT_REMOVE = 'factoru:product:remove'
export const IPC_PRODUCT_RECONNECT = 'factoru:product:reconnect'
export const IPC_PRODUCT_ROOTS = 'factoru:product:roots'
export const IPC_PRODUCT_BROWSE = 'factoru:product:browse'
export const IPC_PRODUCT_PREVIEW = 'factoru:product:preview'
export const IPC_PRODUCT_CREATE = 'factoru:product:create'
export const IPC_PRODUCT_RETRY = 'factoru:product:retry'
export const IPC_PRODUCT_DEVICES = 'factoru:product:devices'
export const IPC_PRODUCT_REVOKE = 'factoru:product:revoke'
export const IPC_PRODUCT_CHANGED = 'factoru:product:changed'
export const IPC_PRODUCT_SELECT_PROJECT = 'factoru:product:select-project'
export const IPC_PRODUCT_SEND_MESSAGE = 'factoru:product:send-message'
export const IPC_PRODUCT_UPDATE_MODEL = 'factoru:product:update-model'
export const IPC_PRODUCT_ADD_MEMORY = 'factoru:product:add-memory'
export const IPC_PRODUCT_START_PLANNER = 'factoru:product:start-planner'
export const IPC_PRODUCT_CANCEL_PLANNER = 'factoru:product:cancel-planner'

export interface ProductBridge {
  get(): Promise<ProductSnapshot>
  pair(url: string, code: string, deviceName: string): Promise<ProductSnapshot>
  activate(serverId: string): Promise<ProductSnapshot>
  remove(serverId: string): Promise<ProductSnapshot>
  reconnect(): Promise<ProductSnapshot>
  roots(): Promise<Array<{ id: string; label: string }>>
  browse(
    rootId: string,
    relativePath: string,
  ): Promise<Array<{ name: string; relativePath: string; kind: 'directory' | 'repository' }>>
  preview(rootId: string, relativePath: string, defaultBranch?: string): Promise<ProjectPreview>
  create(params: {
    rootId: string
    relativePath: string
    name: string
    description?: string
    defaultBranch: string
    fingerprint: string
  }): Promise<Project>
  retry(projectId: string): Promise<unknown>
  devices(): Promise<TrustedDevice[]>
  revoke(deviceId: string): Promise<unknown>
  selectProject(projectId: string): Promise<ProductSnapshot>
  sendMessage(projectId: string, text: string): Promise<ConversationMessage>
  updateModel(input: {
    projectId: string
    workerTypeKind: WorkerType['kind']
    slot: WorkerType['modelBindings'][number]['slot']
    provider: string | null
    model: string | null
  }): Promise<WorkerType>
  addMemory(input: {
    projectId: string
    scope: MemoryEntry['scope']
    workerTypeKind?: WorkerType['kind']
    content: string
    provenanceRef: string
    supersedesId?: string
  }): Promise<MemoryEntry>
  startPlanner(projectId: string): Promise<PlannerProbe>
  cancelPlanner(projectId: string, plannerProbeId: string): Promise<PlannerProbe>
  subscribe(listener: (snapshot: ProductSnapshot) => void): () => void
}
