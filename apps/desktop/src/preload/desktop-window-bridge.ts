import type { IpcRenderer } from 'electron'
import {
  IPC_DESKTOP_WINDOW_CHANGED,
  IPC_DESKTOP_WINDOW_GET,
  desktopPlatform,
  type DesktopWindowBridge,
  type DesktopWindowState,
} from '../shared/desktop-window'

type WindowIpc = Pick<IpcRenderer, 'invoke' | 'on' | 'off'>

export function createDesktopWindowBridge(
  ipc: WindowIpc,
  platform: NodeJS.Platform,
): DesktopWindowBridge {
  return {
    platform: desktopPlatform(platform),
    getState: () => ipc.invoke(IPC_DESKTOP_WINDOW_GET) as Promise<DesktopWindowState>,
    subscribe: (listener) => {
      const handler = (_event: unknown, state: DesktopWindowState) => listener(state)
      ipc.on(IPC_DESKTOP_WINDOW_CHANGED, handler)
      return () => ipc.off(IPC_DESKTOP_WINDOW_CHANGED, handler)
    },
  }
}
