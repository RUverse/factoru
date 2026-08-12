import { IPC_DESKTOP_WINDOW_CHANGED, type DesktopWindowState } from '../shared/desktop-window'

interface WindowStateSource {
  isDestroyed(): boolean
  isFullScreen(): boolean
  on(event: 'enter-full-screen' | 'leave-full-screen', listener: () => void): unknown
  removeListener(event: 'enter-full-screen' | 'leave-full-screen', listener: () => void): unknown
  webContents: { send(channel: string, state: DesktopWindowState): void }
}

export function desktopWindowState(
  window: Pick<WindowStateSource, 'isFullScreen'>,
): DesktopWindowState {
  return { fullScreen: window.isFullScreen() }
}

export function bindWindowStateEvents(window: WindowStateSource): () => void {
  const publish = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_DESKTOP_WINDOW_CHANGED, desktopWindowState(window))
    }
  }
  window.on('enter-full-screen', publish)
  window.on('leave-full-screen', publish)
  return () => {
    window.removeListener('enter-full-screen', publish)
    window.removeListener('leave-full-screen', publish)
  }
}
