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
  IPC_PRODUCT_CREATE,
  IPC_PRODUCT_DEVICES,
  IPC_PRODUCT_GET,
  IPC_PRODUCT_PAIR,
  IPC_PRODUCT_PREVIEW,
  IPC_PRODUCT_RECONNECT,
  IPC_PRODUCT_REMOVE,
  IPC_PRODUCT_RETRY,
  IPC_PRODUCT_REVOKE,
  IPC_PRODUCT_ROOTS,
  type ProductBridge,
} from '../shared/product'

const product: ProductBridge = {
  get: () => ipcRenderer.invoke(IPC_PRODUCT_GET),
  pair: (url, code, deviceName) => ipcRenderer.invoke(IPC_PRODUCT_PAIR, url, code, deviceName),
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
