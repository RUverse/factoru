import path from 'node:path'
import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { createFactoruClient } from '@factoru/protocol'
import { ConnectionRuntime } from './connection-runtime'
import { isExternallyOpenable, isSameOrigin } from './navigation'
import { DESKTOP_NAME, DESKTOP_VERSION } from './version'
import {
  IPC_CONNECTION_CHANGED,
  IPC_CONNECTION_GET,
  IPC_CONNECTION_REFRESH,
} from '../shared/connection'

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
}

void app.whenReady().then(() => {
  registerIpc()
  connection.start()
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
