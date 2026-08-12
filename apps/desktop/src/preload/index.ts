import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CONNECTION_CHANGED,
  IPC_CONNECTION_GET,
  IPC_CONNECTION_REFRESH,
  type ConnectionSnapshot,
  type FactoruBridge,
} from '../shared/connection'
import {
  IPC_PRODUCT_BROWSE,
  IPC_PRODUCT_CHANGED,
  IPC_PRODUCT_CANCEL_PLANNER,
  IPC_PRODUCT_CHOOSE_REPOSITORY_FOLDER,
  IPC_PRODUCT_CHECK_REPOSITORY_ACCESS,
  IPC_PRODUCT_CREATE,
  IPC_PRODUCT_DEVICES,
  IPC_PRODUCT_ADD_MEMORY,
  IPC_PRODUCT_GET,
  IPC_PRODUCT_PAIR,
  IPC_PRODUCT_PAIR_LOCAL,
  IPC_PRODUCT_PREVIEW,
  IPC_PRODUCT_RECONNECT,
  IPC_PRODUCT_RENAME,
  IPC_PRODUCT_REMOVE,
  IPC_PRODUCT_RETRY,
  IPC_PRODUCT_REVOKE,
  IPC_PRODUCT_ROOTS,
  IPC_PRODUCT_SELECT_PROJECT,
  IPC_PRODUCT_SEND_MESSAGE,
  IPC_PRODUCT_UPLOAD_IMAGE,
  IPC_PRODUCT_CANCEL_IMAGE_UPLOAD,
  IPC_PRODUCT_IMAGE_UPLOAD_PROGRESS,
  IPC_PRODUCT_LOAD_IMAGE,
  IPC_PRODUCT_REMOVE_IMAGE,
  IPC_PRODUCT_CANCEL_CONVERSATION,
  IPC_PRODUCT_RETRY_CONVERSATION,
  IPC_PRODUCT_RESET_CONVERSATION_CONTEXT,
  IPC_PRODUCT_LOAD_CONVERSATION_HISTORY,
  IPC_PRODUCT_READ_CONVERSATION_CONTEXT,
  IPC_PRODUCT_START_PLANNER,
  IPC_PRODUCT_UPDATE_MODEL,
  IPC_PRODUCT_UPDATE_WORKFLOW_DEFAULT,
  IPC_PRODUCT_CREATE_TASK,
  IPC_PRODUCT_UPDATE_TASK,
  IPC_PRODUCT_MOVE_TASK,
  IPC_PRODUCT_RESOLVE_TASK,
  IPC_PRODUCT_DECIDE_TASK_MERGE,
  IPC_PRODUCT_CANCEL_RUN,
  IPC_PRODUCT_RETRY_RUN,
  IPC_PRODUCT_REQUEST_RUN_CHANGES,
  IPC_PRODUCT_APPROVE_RUN,
  IPC_PRODUCT_ARCHIVE_RUN,
  IPC_PRODUCT_COMPLETE_REMOTE_FACTORY_INTRO,
  type ProductBridge,
} from '../shared/product'
import { createDesktopWindowBridge } from './desktop-window-bridge'

const product: ProductBridge = {
  get: () => ipcRenderer.invoke(IPC_PRODUCT_GET),
  pair: (url, code, deviceName, factoryName) =>
    ipcRenderer.invoke(IPC_PRODUCT_PAIR, url, code, deviceName, factoryName),
  pairLocal: (deviceName) => ipcRenderer.invoke(IPC_PRODUCT_PAIR_LOCAL, deviceName),
  rename: (serverId, name) => ipcRenderer.invoke(IPC_PRODUCT_RENAME, serverId, name),
  remove: (serverId) => ipcRenderer.invoke(IPC_PRODUCT_REMOVE, serverId),
  reconnect: (serverId) => ipcRenderer.invoke(IPC_PRODUCT_RECONNECT, serverId),
  completeRemoteFactoryIntro: () => ipcRenderer.invoke(IPC_PRODUCT_COMPLETE_REMOTE_FACTORY_INTRO),
  roots: (factoryId) => ipcRenderer.invoke(IPC_PRODUCT_ROOTS, factoryId),
  browse: (factoryId, rootId, relativePath) =>
    ipcRenderer.invoke(IPC_PRODUCT_BROWSE, factoryId, rootId, relativePath),
  preview: (factoryId, rootId, relativePath, defaultBranch) =>
    ipcRenderer.invoke(IPC_PRODUCT_PREVIEW, factoryId, rootId, relativePath, defaultBranch),
  chooseRepositoryFolder: (factoryId) =>
    ipcRenderer.invoke(IPC_PRODUCT_CHOOSE_REPOSITORY_FOLDER, factoryId),
  checkRepositoryAccess: (factoryId, url) =>
    ipcRenderer.invoke(IPC_PRODUCT_CHECK_REPOSITORY_ACCESS, factoryId, url),
  create: (factoryId, params) => ipcRenderer.invoke(IPC_PRODUCT_CREATE, factoryId, params),
  retry: (project) => ipcRenderer.invoke(IPC_PRODUCT_RETRY, project),
  devices: (factoryId) => ipcRenderer.invoke(IPC_PRODUCT_DEVICES, factoryId),
  revoke: (factoryId, deviceId) => ipcRenderer.invoke(IPC_PRODUCT_REVOKE, factoryId, deviceId),
  selectProject: (project) => ipcRenderer.invoke(IPC_PRODUCT_SELECT_PROJECT, project),
  sendMessage: (project, message, artifactIds) =>
    ipcRenderer.invoke(IPC_PRODUCT_SEND_MESSAGE, project, message, artifactIds),
  uploadImage: (input) => ipcRenderer.invoke(IPC_PRODUCT_UPLOAD_IMAGE, input),
  cancelImageUpload: (uploadId) => ipcRenderer.invoke(IPC_PRODUCT_CANCEL_IMAGE_UPLOAD, uploadId),
  subscribeImageUploadProgress: (listener) => {
    const handler = (
      _event: unknown,
      progress: { uploadId: string; uploadedBytes: number; totalBytes: number },
    ) => listener(progress)
    ipcRenderer.on(IPC_PRODUCT_IMAGE_UPLOAD_PROGRESS, handler)
    return () => ipcRenderer.off(IPC_PRODUCT_IMAGE_UPLOAD_PROGRESS, handler)
  },
  loadImage: (project, conversationId, artifactId) =>
    ipcRenderer.invoke(IPC_PRODUCT_LOAD_IMAGE, project, conversationId, artifactId),
  removeImage: (project, conversationId, artifactId) =>
    ipcRenderer.invoke(IPC_PRODUCT_REMOVE_IMAGE, project, conversationId, artifactId),
  cancelConversation: (project, conversationId, turnId) =>
    ipcRenderer.invoke(IPC_PRODUCT_CANCEL_CONVERSATION, project, conversationId, turnId),
  retryConversation: (project, conversationId, messageId) =>
    ipcRenderer.invoke(IPC_PRODUCT_RETRY_CONVERSATION, project, conversationId, messageId),
  resetConversationContext: (project, conversationId) =>
    ipcRenderer.invoke(IPC_PRODUCT_RESET_CONVERSATION_CONTEXT, project, conversationId),
  loadConversationHistory: (project, conversationId, before) =>
    ipcRenderer.invoke(IPC_PRODUCT_LOAD_CONVERSATION_HISTORY, project, conversationId, before),
  readConversationContext: (project, conversationId, contextRevision, before) =>
    ipcRenderer.invoke(
      IPC_PRODUCT_READ_CONVERSATION_CONTEXT,
      project,
      conversationId,
      contextRevision,
      before,
    ),
  updateModel: (input) => ipcRenderer.invoke(IPC_PRODUCT_UPDATE_MODEL, input),
  updateWorkflowDefault: (project, workflowPresetId) =>
    ipcRenderer.invoke(IPC_PRODUCT_UPDATE_WORKFLOW_DEFAULT, project, workflowPresetId),
  addMemory: (input) => ipcRenderer.invoke(IPC_PRODUCT_ADD_MEMORY, input),
  startPlanner: (project) => ipcRenderer.invoke(IPC_PRODUCT_START_PLANNER, project),
  cancelPlanner: (project, plannerProbeId) =>
    ipcRenderer.invoke(IPC_PRODUCT_CANCEL_PLANNER, project, plannerProbeId),
  createTask: (input) => ipcRenderer.invoke(IPC_PRODUCT_CREATE_TASK, input),
  updateTask: (input) => ipcRenderer.invoke(IPC_PRODUCT_UPDATE_TASK, input),
  moveTask: (input) => ipcRenderer.invoke(IPC_PRODUCT_MOVE_TASK, input),
  resolveTask: (input) => ipcRenderer.invoke(IPC_PRODUCT_RESOLVE_TASK, input),
  decideTaskMerge: (input) => ipcRenderer.invoke(IPC_PRODUCT_DECIDE_TASK_MERGE, input),
  cancelRun: (project, runId) => ipcRenderer.invoke(IPC_PRODUCT_CANCEL_RUN, project, runId),
  retryRun: (project, runId) => ipcRenderer.invoke(IPC_PRODUCT_RETRY_RUN, project, runId),
  requestRunChanges: (project, runId, feedback) =>
    ipcRenderer.invoke(IPC_PRODUCT_REQUEST_RUN_CHANGES, project, runId, feedback),
  approveRun: (project, runId, summary) =>
    ipcRenderer.invoke(IPC_PRODUCT_APPROVE_RUN, project, runId, summary),
  archiveRun: (project, runId) => ipcRenderer.invoke(IPC_PRODUCT_ARCHIVE_RUN, project, runId),
  subscribe: (listener) => {
    const handler = (_event: unknown, snapshot: Parameters<typeof listener>[0]) =>
      listener(snapshot)
    ipcRenderer.on(IPC_PRODUCT_CHANGED, handler)
    return () => ipcRenderer.off(IPC_PRODUCT_CHANGED, handler)
  },
}

const bridge: FactoruBridge = {
  desktopWindow: createDesktopWindowBridge(ipcRenderer, process.platform),
  connection: {
    get: () => ipcRenderer.invoke(IPC_CONNECTION_GET) as Promise<ConnectionSnapshot>,
    refresh: () => ipcRenderer.invoke(IPC_CONNECTION_REFRESH) as Promise<ConnectionSnapshot>,
    subscribe: (listener) => {
      const handler = (_event: unknown, snapshot: ConnectionSnapshot) => listener(snapshot)
      ipcRenderer.on(IPC_CONNECTION_CHANGED, handler)
      return () => {
        ipcRenderer.off(IPC_CONNECTION_CHANGED, handler)
      }
    },
  },
  product,
}

contextBridge.exposeInMainWorld('factoru', bridge)
