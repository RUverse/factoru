import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CONNECTION_CHANGED,
  IPC_CONNECTION_GET,
  IPC_CONNECTION_REFRESH,
  type ConnectionSnapshot,
  type FactoruBridge,
} from '../shared/connection'

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
}

contextBridge.exposeInMainWorld('factoru', bridge)
