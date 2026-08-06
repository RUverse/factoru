import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CONNECTION_CHANGED,
  IPC_CONNECTION_GET,
  IPC_CONNECTION_REFRESH,
  type ConnectionSnapshot,
  type FactoruBridge,
} from '../shared/connection'
import {
  IPC_PRODUCT_ACTIVATE,
  IPC_PRODUCT_BROWSE,
  IPC_PRODUCT_CHANGED,
  IPC_PRODUCT_CANCEL_PLANNER,
  IPC_PRODUCT_CREATE,
  IPC_PRODUCT_DEVICES,
  IPC_PRODUCT_ADD_MEMORY,
  IPC_PRODUCT_GET,
  IPC_PRODUCT_PAIR,
  IPC_PRODUCT_PAIR_LOCAL,
  IPC_PRODUCT_PREVIEW,
  IPC_PRODUCT_RECONNECT,
  IPC_PRODUCT_REMOVE,
  IPC_PRODUCT_RETRY,
  IPC_PRODUCT_REVOKE,
  IPC_PRODUCT_ROOTS,
  IPC_PRODUCT_SELECT_PROJECT,
  IPC_PRODUCT_SEND_MESSAGE,
  IPC_PRODUCT_START_PLANNER,
  IPC_PRODUCT_UPDATE_MODEL,
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
  type ProductBridge,
} from '../shared/product'

const product: ProductBridge = {
  get: () => ipcRenderer.invoke(IPC_PRODUCT_GET),
  pair: (url, code, deviceName) => ipcRenderer.invoke(IPC_PRODUCT_PAIR, url, code, deviceName),
  pairLocal: (deviceName) => ipcRenderer.invoke(IPC_PRODUCT_PAIR_LOCAL, deviceName),
  activate: (serverId) => ipcRenderer.invoke(IPC_PRODUCT_ACTIVATE, serverId),
  remove: (serverId) => ipcRenderer.invoke(IPC_PRODUCT_REMOVE, serverId),
  reconnect: () => ipcRenderer.invoke(IPC_PRODUCT_RECONNECT),
  roots: () => ipcRenderer.invoke(IPC_PRODUCT_ROOTS),
  browse: (rootId, relativePath) => ipcRenderer.invoke(IPC_PRODUCT_BROWSE, rootId, relativePath),
  preview: (rootId, relativePath, defaultBranch) =>
    ipcRenderer.invoke(IPC_PRODUCT_PREVIEW, rootId, relativePath, defaultBranch),
  create: (params) => ipcRenderer.invoke(IPC_PRODUCT_CREATE, params),
  retry: (projectId) => ipcRenderer.invoke(IPC_PRODUCT_RETRY, projectId),
  devices: () => ipcRenderer.invoke(IPC_PRODUCT_DEVICES),
  revoke: (deviceId) => ipcRenderer.invoke(IPC_PRODUCT_REVOKE, deviceId),
  selectProject: (projectId) => ipcRenderer.invoke(IPC_PRODUCT_SELECT_PROJECT, projectId),
  sendMessage: (projectId, message) =>
    ipcRenderer.invoke(IPC_PRODUCT_SEND_MESSAGE, projectId, message),
  updateModel: (input) => ipcRenderer.invoke(IPC_PRODUCT_UPDATE_MODEL, input),
  addMemory: (input) => ipcRenderer.invoke(IPC_PRODUCT_ADD_MEMORY, input),
  startPlanner: (projectId) => ipcRenderer.invoke(IPC_PRODUCT_START_PLANNER, projectId),
  cancelPlanner: (projectId, plannerProbeId) =>
    ipcRenderer.invoke(IPC_PRODUCT_CANCEL_PLANNER, projectId, plannerProbeId),
  createTask: (input) => ipcRenderer.invoke(IPC_PRODUCT_CREATE_TASK, input),
  updateTask: (input) => ipcRenderer.invoke(IPC_PRODUCT_UPDATE_TASK, input),
  moveTask: (input) => ipcRenderer.invoke(IPC_PRODUCT_MOVE_TASK, input),
  resolveTask: (input) => ipcRenderer.invoke(IPC_PRODUCT_RESOLVE_TASK, input),
  decideTaskMerge: (input) => ipcRenderer.invoke(IPC_PRODUCT_DECIDE_TASK_MERGE, input),
  cancelRun: (projectId, runId) => ipcRenderer.invoke(IPC_PRODUCT_CANCEL_RUN, projectId, runId),
  retryRun: (projectId, runId) => ipcRenderer.invoke(IPC_PRODUCT_RETRY_RUN, projectId, runId),
  requestRunChanges: (projectId, runId, feedback) =>
    ipcRenderer.invoke(IPC_PRODUCT_REQUEST_RUN_CHANGES, projectId, runId, feedback),
  approveRun: (projectId, runId, summary) =>
    ipcRenderer.invoke(IPC_PRODUCT_APPROVE_RUN, projectId, runId, summary),
  archiveRun: (projectId, runId) => ipcRenderer.invoke(IPC_PRODUCT_ARCHIVE_RUN, projectId, runId),
  subscribe: (listener) => {
    const handler = (_event: unknown, snapshot: Parameters<typeof listener>[0]) =>
      listener(snapshot)
    ipcRenderer.on(IPC_PRODUCT_CHANGED, handler)
    return () => ipcRenderer.off(IPC_PRODUCT_CHANGED, handler)
  },
}

const bridge: FactoruBridge = {
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
