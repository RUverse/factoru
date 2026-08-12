import type { BrowserWindowConstructorOptions } from 'electron'

export const DESKTOP_WINDOW_SIZE = {
  defaultWidth: 1_280,
  defaultHeight: 820,
  minWidth: 720,
  minHeight: 480,
  titleBarHeight: 48,
} as const

export const WINDOW_BACKGROUND = {
  light: '#f5f5f2',
  dark: '#0d0e10',
} as const

export function windowBackground(dark: boolean): string {
  return dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

export function windowChromeOptions(
  platform: NodeJS.Platform,
  dark: boolean,
): Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition' | 'titleBarOverlay' | 'backgroundColor'
> {
  const backgroundColor = windowBackground(dark)
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 17 },
      backgroundColor,
    }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: dark ? '#f1f1ef' : '#1c1d20',
      height: DESKTOP_WINDOW_SIZE.titleBarHeight,
    },
    backgroundColor,
  }
}

export function titleBarOverlay(
  dark: boolean,
): Exclude<BrowserWindowConstructorOptions['titleBarOverlay'], boolean | undefined> {
  return {
    color: '#00000000',
    symbolColor: dark ? '#f1f1ef' : '#1c1d20',
    height: DESKTOP_WINDOW_SIZE.titleBarHeight,
  }
}

interface ThemeWindow {
  isDestroyed(): boolean
  setBackgroundColor(color: string): void
  setTitleBarOverlay(options: ReturnType<typeof titleBarOverlay>): void
}

export function applyWindowTheme(
  windows: readonly ThemeWindow[],
  platform: NodeJS.Platform,
  dark: boolean,
): void {
  for (const window of windows) {
    if (window.isDestroyed()) continue
    window.setBackgroundColor(windowBackground(dark))
    if (platform !== 'darwin') window.setTitleBarOverlay(titleBarOverlay(dark))
  }
}
