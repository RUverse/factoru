import type {
  ConversationMessage,
  MemoryEntry,
  PlannerProbe,
  Project,
  ProjectPreview,
  TrustedDevice,
  WorkerType,
  Workspace,
  Task,
  TaskMergeProposal,
  ExecutionRun,
  RepositoryAccessCheck,
  RepositoryAccessErrorCode,
  Artifact,
  ConversationHistoryPage,
  RunDetail,
} from '@factoru/protocol'

export interface ServerProfileSummary {
  serverId: string
  deviceId: string
  kind: 'local' | 'remote'
  name: string
  url: string
  createdAt: string
  lastConnectedAt: string | null
  connectionState: 'connected' | 'connecting' | 'offline' | 'blocked' | 'pairing_required'
  error: string | null
}

export interface ProjectRef {
  factoryId: string
  projectId: string
}

export interface LocatedProject {
  ref: ProjectRef
  project: Project
  factoryName: string
  factoryKind: ServerProfileSummary['kind']
  factoryConnectionState: ServerProfileSummary['connectionState']
}

export interface ProductSnapshot {
  initialized: boolean
  profiles: ServerProfileSummary[]
  projects: LocatedProject[]
  activeProjectRef: ProjectRef | null
  workspace: Workspace | null
  connected: boolean
  cached: boolean
  error: string | null
  remoteFactoryIntroComplete: boolean
  selectedRunDetail: RunDetail | null
}

export type ConversationHistoryResult = Omit<ConversationHistoryPage, 'messages'> & {
  messages: ConversationMessage[]
}

export type RepositoryAccessOutcome =
  | { ok: true; result: RepositoryAccessCheck }
  | {
      ok: false
      error: { code: RepositoryAccessErrorCode | 'unavailable'; message: string }
    }

export const IPC_PRODUCT_GET = 'factoru:product:get'
export const IPC_PRODUCT_PAIR = 'factoru:product:pair'
export const IPC_PRODUCT_PAIR_LOCAL = 'factoru:product:pair-local'
export const IPC_PRODUCT_RENAME = 'factoru:product:rename'
export const IPC_PRODUCT_REMOVE = 'factoru:product:remove'
export const IPC_PRODUCT_RECONNECT = 'factoru:product:reconnect'
export const IPC_PRODUCT_ROOTS = 'factoru:product:roots'
export const IPC_PRODUCT_BROWSE = 'factoru:product:browse'
export const IPC_PRODUCT_PREVIEW = 'factoru:product:preview'
export const IPC_PRODUCT_CHOOSE_REPOSITORY_FOLDER = 'factoru:product:choose-repository-folder'
export const IPC_PRODUCT_CHECK_REPOSITORY_ACCESS = 'factoru:product:check-repository-access'
export const IPC_PRODUCT_CREATE = 'factoru:product:create'
export const IPC_PRODUCT_RETRY = 'factoru:product:retry'
export const IPC_PRODUCT_DEVICES = 'factoru:product:devices'
export const IPC_PRODUCT_REVOKE = 'factoru:product:revoke'
export const IPC_PRODUCT_CHANGED = 'factoru:product:changed'
export const IPC_PRODUCT_SELECT_PROJECT = 'factoru:product:select-project'
export const IPC_PRODUCT_SELECT_RUN = 'factoru:product:select-run'
export const IPC_PRODUCT_SEND_MESSAGE = 'factoru:product:send-message'
export const IPC_PRODUCT_UPLOAD_IMAGE = 'factoru:product:upload-image'
export const IPC_PRODUCT_CANCEL_IMAGE_UPLOAD = 'factoru:product:cancel-image-upload'
export const IPC_PRODUCT_IMAGE_UPLOAD_PROGRESS = 'factoru:product:image-upload-progress'
export const IPC_PRODUCT_LOAD_IMAGE = 'factoru:product:load-image'
export const IPC_PRODUCT_REMOVE_IMAGE = 'factoru:product:remove-image'
export const IPC_PRODUCT_CANCEL_CONVERSATION = 'factoru:product:cancel-conversation'
export const IPC_PRODUCT_RETRY_CONVERSATION = 'factoru:product:retry-conversation'
export const IPC_PRODUCT_RESET_CONVERSATION_CONTEXT = 'factoru:product:reset-conversation-context'
export const IPC_PRODUCT_LOAD_CONVERSATION_HISTORY = 'factoru:product:load-conversation-history'
export const IPC_PRODUCT_READ_CONVERSATION_CONTEXT = 'factoru:product:read-conversation-context'
export const IPC_PRODUCT_UPDATE_MODEL = 'factoru:product:update-model'
export const IPC_PRODUCT_UPDATE_WORKFLOW_DEFAULT = 'factoru:product:update-workflow-default'
export const IPC_PRODUCT_ADD_MEMORY = 'factoru:product:add-memory'
export const IPC_PRODUCT_START_PLANNER = 'factoru:product:start-planner'
export const IPC_PRODUCT_CANCEL_PLANNER = 'factoru:product:cancel-planner'
export const IPC_PRODUCT_CREATE_TASK = 'factoru:product:create-task'
export const IPC_PRODUCT_UPDATE_TASK = 'factoru:product:update-task'
export const IPC_PRODUCT_MOVE_TASK = 'factoru:product:move-task'
export const IPC_PRODUCT_RESOLVE_TASK = 'factoru:product:resolve-task'
export const IPC_PRODUCT_DECIDE_TASK_MERGE = 'factoru:product:decide-task-merge'
export const IPC_PRODUCT_CANCEL_RUN = 'factoru:product:cancel-run'
export const IPC_PRODUCT_RETRY_RUN = 'factoru:product:retry-run'
export const IPC_PRODUCT_REQUEST_RUN_CHANGES = 'factoru:product:request-run-changes'
export const IPC_PRODUCT_APPROVE_RUN = 'factoru:product:approve-run'
export const IPC_PRODUCT_ARCHIVE_RUN = 'factoru:product:archive-run'
export const IPC_PRODUCT_COMPLETE_REMOTE_FACTORY_INTRO =
  'factoru:product:complete-remote-factory-intro'

export interface ProductBridge {
  get(): Promise<ProductSnapshot>
  pair(url: string, code: string, deviceName: string, factoryName: string): Promise<ProductSnapshot>
  pairLocal(deviceName: string): Promise<ProductSnapshot>
  rename(serverId: string, name: string): Promise<ProductSnapshot>
  remove(serverId: string): Promise<ProductSnapshot>
  reconnect(serverId: string): Promise<ProductSnapshot>
  completeRemoteFactoryIntro(): Promise<ProductSnapshot>
  roots(factoryId: string): Promise<Array<{ id: string; label: string }>>
  browse(
    factoryId: string,
    rootId: string,
    relativePath: string,
  ): Promise<Array<{ name: string; relativePath: string; kind: 'directory' | 'repository' }>>
  preview(
    factoryId: string,
    rootId: string,
    relativePath: string,
    defaultBranch?: string,
  ): Promise<ProjectPreview>
  chooseRepositoryFolder(factoryId: string): Promise<ProjectPreview | null>
  checkRepositoryAccess(factoryId: string, url: string): Promise<RepositoryAccessOutcome>
  create(
    factoryId: string,
    params: {
      name: string
      description?: string
      blueprintId: 'standard-software-project' | 'fast-patch'
      repositories: Array<
        | {
            kind: 'local'
            rootId: string
            relativePath: string
            defaultBranch: string
            fingerprint: string
          }
        | { kind: 'remote'; url: string }
      >
    },
  ): Promise<ProductSnapshot>
  retry(project: ProjectRef): Promise<unknown>
  devices(factoryId: string): Promise<TrustedDevice[]>
  revoke(factoryId: string, deviceId: string): Promise<unknown>
  selectProject(project: ProjectRef): Promise<ProductSnapshot>
  selectRun(project: ProjectRef, runId: string | null): Promise<RunDetail | null>
  sendMessage(
    project: ProjectRef,
    text: string,
    artifactIds?: string[],
  ): Promise<ConversationMessage>
  uploadImage(input: {
    uploadId: string
    project: ProjectRef
    conversationId: string
    fileName: string
    mimeType: string
    provenance: 'picker' | 'paste' | 'drop'
    bytes: Uint8Array
  }): Promise<Artifact>
  cancelImageUpload(uploadId: string): Promise<boolean>
  subscribeImageUploadProgress(
    listener: (progress: { uploadId: string; uploadedBytes: number; totalBytes: number }) => void,
  ): () => void
  loadImage(
    project: ProjectRef,
    conversationId: string,
    artifactId: string,
  ): Promise<{
    mimeType: string
    bytes: Uint8Array
  }>
  removeImage(project: ProjectRef, conversationId: string, artifactId: string): Promise<void>
  cancelConversation(project: ProjectRef, conversationId: string, turnId: string): Promise<unknown>
  retryConversation(
    project: ProjectRef,
    conversationId: string,
    messageId: string,
  ): Promise<ConversationMessage>
  resetConversationContext(
    project: ProjectRef,
    conversationId: string,
  ): Promise<Workspace['conversation']>
  loadConversationHistory(
    project: ProjectRef,
    conversationId: string,
    before?: string,
  ): Promise<ProductSnapshot>
  readConversationContext(
    project: ProjectRef,
    conversationId: string,
    contextRevision: number,
    before?: string,
  ): Promise<ConversationHistoryResult>
  updateModel(input: {
    project: ProjectRef
    workerTypeKind: WorkerType['kind']
    slot: WorkerType['modelBindings'][number]['slot']
    provider: string | null
    model: string | null
  }): Promise<WorkerType>
  updateWorkflowDefault(
    project: ProjectRef,
    workflowPresetId: 'standard-build' | 'fast-patch',
  ): Promise<Workspace['factory']>
  addMemory(input: {
    project: ProjectRef
    scope: MemoryEntry['scope']
    workerTypeKind?: WorkerType['kind']
    content: string
    provenanceRef: string
    supersedesId?: string
  }): Promise<MemoryEntry>
  startPlanner(project: ProjectRef): Promise<PlannerProbe>
  cancelPlanner(project: ProjectRef, plannerProbeId: string): Promise<PlannerProbe>
  createTask(input: {
    project: ProjectRef
    title: string
    description?: string
    status: 'backlog' | 'queue'
  }): Promise<Task>
  updateTask(input: {
    project: ProjectRef
    taskId: string
    title?: string
    description?: string
    priority?: number
    workflowPresetId?: 'standard-build' | 'fast-patch' | null
  }): Promise<Task>
  moveTask(input: {
    project: ProjectRef
    taskId: string
    status: Task['status']
    needsYouAction?: NonNullable<Task['needsYouAction']>
    needsYouMessage?: string
  }): Promise<Task>
  resolveTask(input: {
    project: ProjectRef
    taskId: string
    resolution: Exclude<NonNullable<Task['resolution']>, 'superseded'>
    summary: string
  }): Promise<Task>
  decideTaskMerge(input: {
    project: ProjectRef
    proposalId: string
    decision: 'accept' | 'reject'
  }): Promise<TaskMergeProposal>
  cancelRun(project: ProjectRef, runId: string): Promise<ExecutionRun>
  retryRun(project: ProjectRef, runId: string): Promise<Task>
  requestRunChanges(project: ProjectRef, runId: string, feedback: string): Promise<Task>
  approveRun(project: ProjectRef, runId: string, summary: string): Promise<Task>
  archiveRun(project: ProjectRef, runId: string): Promise<ExecutionRun>
  subscribe(listener: (snapshot: ProductSnapshot) => void): () => void
}
