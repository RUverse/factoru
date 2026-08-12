import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_LAYOUT_PREFERENCES,
  clamp,
  DESKTOP_LAYOUT,
  LAYOUT_PREFERENCES_KEY,
  inspectorMaximumForViewport,
  parseLayoutPreferences,
  resolvePaneWidths,
  resolveViewportMode,
  serializeLayoutPreferences,
  sidebarMaximumForViewport,
  type DesktopViewportMode,
  type LayoutPreferences,
} from './layout-config'

function viewportWidth(): number {
  return typeof window === 'undefined'
    ? 1_280
    : Math.round(document.documentElement.clientWidth || window.innerWidth)
}

function initialPreferences(): LayoutPreferences {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT_PREFERENCES
  return parseLayoutPreferences(window.localStorage.getItem(LAYOUT_PREFERENCES_KEY))
}

export interface DesktopLayoutState {
  mode: DesktopViewportMode
  sidebarWidth: number
  inspectorWidth: number
  sidebarMaximum: number
  inspectorMaximum: number
  sidebarCollapsed: boolean
  sidebarDrawerOpen: boolean
  inspectorDrawerOpen: boolean
  setSidebarWidth(value: number): void
  setInspectorWidth(value: number): void
  toggleSidebar(): void
  toggleInspector(): void
  closeDrawers(): void
}

export function useDesktopLayout(): DesktopLayoutState {
  const [width, setWidth] = useState(viewportWidth)
  const [preferences, setPreferences] = useState(initialPreferences)
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false)
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false)
  const mode = resolveViewportMode(width)
  const resolved = useMemo(() => {
    if (mode === 'wide' && !preferences.sidebarCollapsed) {
      return resolvePaneWidths(width, preferences.sidebarWidth, preferences.inspectorWidth)
    }
    return {
      sidebar: clamp(
        preferences.sidebarWidth,
        DESKTOP_LAYOUT.sidebar.min,
        DESKTOP_LAYOUT.sidebar.max,
      ),
      inspector: clamp(
        preferences.inspectorWidth,
        DESKTOP_LAYOUT.inspector.min,
        mode === 'compact' ? DESKTOP_LAYOUT.inspector.max : inspectorMaximumForViewport(width, 0),
      ),
    }
  }, [
    mode,
    preferences.inspectorWidth,
    preferences.sidebarCollapsed,
    preferences.sidebarWidth,
    width,
  ])

  useEffect(() => {
    const resize = (): void => setWidth(viewportWidth())
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_PREFERENCES_KEY, serializeLayoutPreferences(preferences))
  }, [preferences])

  useEffect(() => {
    setSidebarDrawerOpen(false)
    setInspectorDrawerOpen(false)
  }, [mode])

  const sidebarMaximum = sidebarMaximumForViewport(width, resolved.inspector)
  const inspectorMaximum = inspectorMaximumForViewport(
    width,
    mode === 'wide' && !preferences.sidebarCollapsed ? resolved.sidebar : 0,
  )

  return {
    mode,
    sidebarWidth: resolved.sidebar,
    inspectorWidth: resolved.inspector,
    sidebarMaximum,
    inspectorMaximum,
    sidebarCollapsed: preferences.sidebarCollapsed,
    sidebarDrawerOpen,
    inspectorDrawerOpen,
    setSidebarWidth: (value) => setPreferences((current) => ({ ...current, sidebarWidth: value })),
    setInspectorWidth: (value) =>
      setPreferences((current) => ({ ...current, inspectorWidth: value })),
    toggleSidebar: () => {
      if (mode === 'wide') {
        setPreferences((current) => ({
          ...current,
          sidebarCollapsed: !current.sidebarCollapsed,
        }))
      } else {
        setInspectorDrawerOpen(false)
        setSidebarDrawerOpen((open) => !open)
      }
    },
    toggleInspector: () => {
      if (mode !== 'compact') return
      setSidebarDrawerOpen(false)
      setInspectorDrawerOpen((open) => !open)
    },
    closeDrawers: () => {
      setSidebarDrawerOpen(false)
      setInspectorDrawerOpen(false)
    },
  }
}

export const SIDEBAR_RESIZE_LIMITS = DESKTOP_LAYOUT.sidebar
export const INSPECTOR_RESIZE_LIMITS = DESKTOP_LAYOUT.inspector
