import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, app, ipcMain, safeStorage, shell } from 'electron'
import { createFactoruClient } from '@factoru/protocol'
import { ConnectionRuntime } from './connection-runtime'
import { isExternallyOpenable, isSameOrigin } from './navigation'
import { DESKTOP_NAME, DESKTOP_VERSION } from './version'
import { CredentialStore, ProfileStore } from './profile-store'
import { ProductRuntime } from './product-runtime'
import {
  IPC_CONNECTION_CHANGED,
  IPC_CONNECTION_GET,
  IPC_CONNECTION_REFRESH,
} from '../shared/connection'
import {
  IPC_PRODUCT_ACTIVATE,
  IPC_PRODUCT_ADD_MEMORY,
  IPC_PRODUCT_BROWSE,
  IPC_PRODUCT_CHANGED,
  IPC_PRODUCT_CANCEL_PLANNER,
  IPC_PRODUCT_CREATE,
  IPC_PRODUCT_DEVICES,
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
} from '../shared/product'

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787'

/**
 * Which server this desktop talks to. Milestone 2 replaces the environment
 * variable with persisted connection profiles and a pairing flow.
 */
function serverUrl(): string {
  return process.env.FACTORU_SERVER_URL?.trim() || DEFAULT_SERVER_URL
}

const connection = new ConnectionRuntime({
  client: createFactoruClient({
    baseUrl: serverUrl(),
    clientName: DESKTOP_NAME,
    clientVersion: DESKTOP_VERSION,
  }),
})

let product: ProductRuntime

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1_100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Factoru',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  // The renderer is untrusted: it may not navigate away or open windows, and
  // only web URLs may reach the operating system's default handler.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternallyOpenable(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isSameOrigin(url, process.env.ELECTRON_RENDERER_URL)) {
      event.preventDefault()
    }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    void window.loadURL(devServer)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

function registerIpc(): void {
  ipcMain.handle(IPC_CONNECTION_GET, () => connection.snapshot)
  ipcMain.handle(IPC_CONNECTION_REFRESH, async () => connection.refresh())

  connection.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CONNECTION_CHANGED, snapshot)
      }
    }
  })

  ipcMain.handle(IPC_PRODUCT_GET, () => product.snapshot)
  ipcMain.handle(IPC_PRODUCT_PAIR, (_event, url: string, code: string, deviceName: string) =>
    product.pair(url, code, deviceName),
  )
  ipcMain.handle(IPC_PRODUCT_PAIR_LOCAL, (_event, deviceName: string) =>
    product.pairLocal(deviceName),
  )
  ipcMain.handle(IPC_PRODUCT_ACTIVATE, (_event, serverId: string) => product.activate(serverId))
  ipcMain.handle(IPC_PRODUCT_REMOVE, (_event, serverId: string) => product.remove(serverId))
  ipcMain.handle(IPC_PRODUCT_RECONNECT, () => product.connect())
  ipcMain.handle(IPC_PRODUCT_ROOTS, () => product.request('repositories.roots'))
  ipcMain.handle(IPC_PRODUCT_BROWSE, (_event, rootId: string, relativePath: string) =>
    product.request('repositories.browse', { rootId, relativePath }),
  )
  ipcMain.handle(
    IPC_PRODUCT_PREVIEW,
    (_event, rootId: string, relativePath: string, defaultBranch?: string) =>
      product.preview(rootId, relativePath, defaultBranch),
  )
  ipcMain.handle(IPC_PRODUCT_CREATE, (_event, params: unknown) => product.create(params))
  ipcMain.handle(IPC_PRODUCT_RETRY, (_event, projectId: string) =>
    product.request('projects.retrySetup', { projectId }, `cmd_${randomUUID()}`),
  )
  ipcMain.handle(IPC_PRODUCT_DEVICES, () => product.devices())
  ipcMain.handle(IPC_PRODUCT_REVOKE, (_event, deviceId: string) => product.revoke(deviceId))
  ipcMain.handle(IPC_PRODUCT_SELECT_PROJECT, (_event, projectId: string) =>
    product.selectProject(projectId),
  )
  ipcMain.handle(IPC_PRODUCT_SEND_MESSAGE, (_event, projectId: string, message: string) =>
    product.sendMessage(projectId, message),
  )
  ipcMain.handle(
    IPC_PRODUCT_UPDATE_MODEL,
    (_event, input: Parameters<ProductRuntime['updateModel']>[0]) => product.updateModel(input),
  )
  ipcMain.handle(
    IPC_PRODUCT_ADD_MEMORY,
    (_event, input: Parameters<ProductRuntime['addMemory']>[0]) => product.addMemory(input),
  )
  ipcMain.handle(IPC_PRODUCT_START_PLANNER, (_event, projectId: string) =>
    product.startPlanner(projectId),
  )
  ipcMain.handle(IPC_PRODUCT_CANCEL_PLANNER, (_event, projectId: string, plannerProbeId: string) =>
    product.cancelPlanner(projectId, plannerProbeId),
  )
  ipcMain.handle(
    IPC_PRODUCT_CREATE_TASK,
    (_event, input: Parameters<ProductRuntime['createTask']>[0]) => product.createTask(input),
  )
  ipcMain.handle(
    IPC_PRODUCT_UPDATE_TASK,
    (_event, input: Parameters<ProductRuntime['updateTask']>[0]) => product.updateTask(input),
  )
  ipcMain.handle(
    IPC_PRODUCT_MOVE_TASK,
    (_event, input: Parameters<ProductRuntime['moveTask']>[0]) => product.moveTask(input),
  )
  ipcMain.handle(
    IPC_PRODUCT_RESOLVE_TASK,
    (_event, input: Parameters<ProductRuntime['resolveTask']>[0]) => product.resolveTask(input),
  )
  ipcMain.handle(
    IPC_PRODUCT_DECIDE_TASK_MERGE,
    (_event, input: Parameters<ProductRuntime['decideTaskMerge']>[0]) =>
      product.decideTaskMerge(input),
  )
  product.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_PRODUCT_CHANGED, snapshot)
    }
  })
}

void app.whenReady().then(() => {
  const dataDirectory = app.getPath('userData')
  product = new ProductRuntime(
    new ProfileStore(dataDirectory),
    new CredentialStore(dataDirectory, safeStorage),
    { localEnrollmentFile: process.env.FACTORU_LOCAL_ENROLLMENT_FILE?.trim() },
  )
  registerIpc()
  if (product.snapshot.activeServerId) void product.connect()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    connection.stop()
    app.quit()
  }
})

app.on('before-quit', () => connection.stop())
