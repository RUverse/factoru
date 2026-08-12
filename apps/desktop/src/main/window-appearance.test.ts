import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_WINDOW_SIZE,
  WINDOW_BACKGROUND,
  applyWindowTheme,
  titleBarOverlay,
  windowChromeOptions,
} from './window-appearance'

describe('desktop window appearance', () => {
  it('retains inset macOS traffic lights in the integrated title region', () => {
    expect(windowChromeOptions('darwin', true)).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 17 },
      backgroundColor: WINDOW_BACKGROUND.dark,
    })
  })

  it('retains overlay controls on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(windowChromeOptions(platform, false)).toEqual({
        titleBarStyle: 'hidden',
        titleBarOverlay: titleBarOverlay(false),
        backgroundColor: WINDOW_BACKGROUND.light,
      })
    }
  })

  it('uses the requested default and compact minimum sizes', () => {
    expect(DESKTOP_WINDOW_SIZE).toMatchObject({
      defaultWidth: 1280,
      defaultHeight: 820,
      minWidth: 720,
      minHeight: 480,
      titleBarHeight: 48,
    })
  })

  it('synchronizes window backgrounds and native overlay symbols with the system theme', () => {
    const setBackgroundColor = vi.fn()
    const setTitleBarOverlay = vi.fn()
    applyWindowTheme(
      [{ isDestroyed: () => false, setBackgroundColor, setTitleBarOverlay }],
      'win32',
      true,
    )
    expect(setBackgroundColor).toHaveBeenCalledWith(WINDOW_BACKGROUND.dark)
    expect(setTitleBarOverlay).toHaveBeenCalledWith(titleBarOverlay(true))
  })
})
