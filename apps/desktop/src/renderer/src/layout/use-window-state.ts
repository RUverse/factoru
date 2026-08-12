import { useEffect, useState } from 'react'

export function useWindowState(): { platform: 'darwin' | 'win32' | 'linux'; fullScreen: boolean } {
  const platform = window.factoru.desktopWindow.platform
  const [fullScreen, setFullScreen] = useState(false)
  useEffect(() => {
    let active = true
    void window.factoru.desktopWindow.getState().then((state) => {
      if (active) setFullScreen(state.fullScreen)
    })
    const unsubscribe = window.factoru.desktopWindow.subscribe((state) =>
      setFullScreen(state.fullScreen),
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    document.documentElement.dataset.platform = platform
    document.documentElement.dataset.fullscreen = String(fullScreen)
  }, [fullScreen, platform])
  return { platform, fullScreen }
}
