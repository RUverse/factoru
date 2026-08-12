export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

export interface DesktopWindowState {
  readonly fullScreen: boolean
}

export interface DesktopWindowBridge {
  readonly platform: DesktopPlatform
  getState(): Promise<DesktopWindowState>
  subscribe(listener: (state: DesktopWindowState) => void): () => void
}

export const IPC_DESKTOP_WINDOW_GET = 'factoru:desktop-window:get' as const
export const IPC_DESKTOP_WINDOW_CHANGED = 'factoru:desktop-window:changed' as const

export function desktopPlatform(platform: NodeJS.Platform): DesktopPlatform {
  if (platform === 'darwin' || platform === 'win32') return platform
  return 'linux'
}
