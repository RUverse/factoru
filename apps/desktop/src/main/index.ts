import path from 'node:path'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  type OpenDialogOptions,
} from 'electron'
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
  IPC_PRODUCT_ADD_MEMORY,
  IPC_PRODUCT_BROWSE,
  IPC_PRODUCT_CHANGED,
  IPC_PRODUCT_CANCEL_PLANNER,
  IPC_PRODUCT_CHOOSE_REPOSITORY_FOLDER,
  IPC_PRODUCT_CREATE,
  IPC_PRODUCT_DEVICES,
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
  IPC_PRODUCT_COMPLETE_REMOTE_FACTORY_INTRO,
  type ProjectRef,
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
  ipcMain.handle(
    IPC_PRODUCT_PAIR,
    (_event, url: string, code: string, deviceName: string, factoryName: string) =>
      product.pair(url, code, deviceName, factoryName),
  )
  ipcMain.handle(IPC_PRODUCT_PAIR_LOCAL, (_event, deviceName: string) =>
    product.pairLocal(deviceName),
  )
  ipcMain.handle(IPC_PRODUCT_RENAME, (_event, serverId: string, name: string) =>
    product.rename(serverId, name),
  )
  ipcMain.handle(IPC_PRODUCT_REMOVE, (_event, serverId: string) => product.remove(serverId))
  ipcMain.handle(IPC_PRODUCT_RECONNECT, (_event, serverId: string) => product.connect(serverId))
  ipcMain.handle(IPC_PRODUCT_COMPLETE_REMOTE_FACTORY_INTRO, () =>
    product.completeRemoteFactoryIntro(),
  )
  ipcMain.handle(IPC_PRODUCT_ROOTS, (_event, factoryId: string) =>
    product.request(factoryId, 'repositories.roots'),
  )
  ipcMain.handle(
    IPC_PRODUCT_BROWSE,
    (_event, factoryId: string, rootId: string, relativePath: string) =>
      product.request(factoryId, 'repositories.browse', { rootId, relativePath }),
  )
  ipcMain.handle(
    IPC_PRODUCT_PREVIEW,
    (_event, factoryId: string, rootId: string, relativePath: string, defaultBranch?: string) =>
      product.preview(factoryId, rootId, relativePath, defaultBranch),
  )
  ipcMain.handle(IPC_PRODUCT_CHOOSE_REPOSITORY_FOLDER, async (event, factoryId: string) => {
    const factory = product.snapshot.profiles.find((profile) => profile.serverId === factoryId)
    if (factory?.kind !== 'local') {
      throw new Error('Native folder selection is available only for Local Factory')
    }
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options: OpenDialogOptions = {
      title: 'Choose a Git repository',
      buttonLabel: 'Add repository',
      properties: ['openDirectory'],
    }
    const selection = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    const selectedPath = selection.filePaths[0]
    return selection.canceled || !selectedPath ? null : product.previewPath(factoryId, selectedPath)
  })
  ipcMain.handle(IPC_PRODUCT_CREATE, (_event, factoryId: string, params: unknown) =>
    product.create(factoryId, params),
  )
  ipcMain.handle(IPC_PRODUCT_RETRY, (_event, project: ProjectRef) =>
    product.request(
      project.factoryId,
      'projects.retrySetup',
      { projectId: project.projectId },
      `cmd_${randomUUID()}`,
    ),
  )
  ipcMain.handle(IPC_PRODUCT_DEVICES, (_event, factoryId: string) => product.devices(factoryId))
  ipcMain.handle(IPC_PRODUCT_REVOKE, (_event, factoryId: string, deviceId: string) =>
    product.revoke(factoryId, deviceId),
  )
  ipcMain.handle(IPC_PRODUCT_SELECT_PROJECT, (_event, project: ProjectRef) =>
    product.selectProject(project),
  )
  ipcMain.handle(IPC_PRODUCT_SEND_MESSAGE, (_event, project: ProjectRef, message: string) =>
    product.sendMessage(project, message),
  )
  ipcMain.handle(
    IPC_PRODUCT_UPDATE_MODEL,
    (_event, input: Parameters<ProductRuntime['updateModel']>[0]) => product.updateModel(input),
  )
  ipcMain.handle(
    IPC_PRODUCT_ADD_MEMORY,
    (_event, input: Parameters<ProductRuntime['addMemory']>[0]) => product.addMemory(input),
  )
  ipcMain.handle(IPC_PRODUCT_START_PLANNER, (_event, project: ProjectRef) =>
    product.startPlanner(project),
  )
  ipcMain.handle(
    IPC_PRODUCT_CANCEL_PLANNER,
    (_event, project: ProjectRef, plannerProbeId: string) =>
      product.cancelPlanner(project, plannerProbeId),
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
  ipcMain.handle(IPC_PRODUCT_CANCEL_RUN, (_event, project: ProjectRef, runId: string) =>
    product.cancelRun(project, runId),
  )
  ipcMain.handle(IPC_PRODUCT_RETRY_RUN, (_event, project: ProjectRef, runId: string) =>
    product.retryRun(project, runId),
  )
  ipcMain.handle(
    IPC_PRODUCT_REQUEST_RUN_CHANGES,
    (_event, project: ProjectRef, runId: string, feedback: string) =>
      product.requestRunChanges(project, runId, feedback),
  )
  ipcMain.handle(
    IPC_PRODUCT_APPROVE_RUN,
    (_event, project: ProjectRef, runId: string, summary: string) =>
      product.approveRun(project, runId, summary),
  )
  ipcMain.handle(IPC_PRODUCT_ARCHIVE_RUN, (_event, project: ProjectRef, runId: string) =>
    product.archiveRun(project, runId),
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
  void product.initialize(os.hostname())
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

app.on('before-quit', () => {
  connection.stop()
  product?.dispose()
})
