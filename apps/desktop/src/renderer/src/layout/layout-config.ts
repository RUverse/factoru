export const DESKTOP_LAYOUT = {
  titleBarHeight: 48,
  resizeHandleWidth: 1,
  conversation: { min: 480 },
  sidebar: { default: 256, min: 208, max: 360 },
  inspector: { default: 420, min: 320, max: 640 },
} as const

export const DESKTOP_LAYOUT_BREAKPOINTS = {
  inspectorDrawerBelow:
    DESKTOP_LAYOUT.conversation.min +
    DESKTOP_LAYOUT.inspector.min +
    DESKTOP_LAYOUT.resizeHandleWidth,
  sidebarDrawerBelow:
    DESKTOP_LAYOUT.sidebar.min +
    DESKTOP_LAYOUT.conversation.min +
    DESKTOP_LAYOUT.inspector.min +
    DESKTOP_LAYOUT.resizeHandleWidth * 2,
} as const

export type DesktopViewportMode = 'wide' | 'sidebar-drawer' | 'compact'

export interface LayoutPreferences {
  version: 1
  sidebarWidth: number
  inspectorWidth: number
  sidebarCollapsed: boolean
}

export interface ResolvedPaneWidths {
  sidebar: number
  inspector: number
}

export const LAYOUT_PREFERENCES_KEY = 'factoru.desktop-layout.v1'

export const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  version: 1,
  sidebarWidth: DESKTOP_LAYOUT.sidebar.default,
  inspectorWidth: DESKTOP_LAYOUT.inspector.default,
  sidebarCollapsed: false,
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseLayoutPreferences(serialized: string | null): LayoutPreferences {
  if (!serialized) return DEFAULT_LAYOUT_PREFERENCES
  try {
    const value: unknown = JSON.parse(serialized)
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
      return DEFAULT_LAYOUT_PREFERENCES
    }
    const candidate = value as Record<string, unknown>
    const sidebarWidth = finiteNumber(candidate.sidebarWidth)
    const inspectorWidth = finiteNumber(candidate.inspectorWidth)
    return {
      version: 1,
      sidebarWidth: clamp(
        sidebarWidth ?? DESKTOP_LAYOUT.sidebar.default,
        DESKTOP_LAYOUT.sidebar.min,
        DESKTOP_LAYOUT.sidebar.max,
      ),
      inspectorWidth: clamp(
        inspectorWidth ?? DESKTOP_LAYOUT.inspector.default,
        DESKTOP_LAYOUT.inspector.min,
        DESKTOP_LAYOUT.inspector.max,
      ),
      sidebarCollapsed:
        typeof candidate.sidebarCollapsed === 'boolean'
          ? candidate.sidebarCollapsed
          : DEFAULT_LAYOUT_PREFERENCES.sidebarCollapsed,
    }
  } catch {
    return DEFAULT_LAYOUT_PREFERENCES
  }
}

export function serializeLayoutPreferences(preferences: LayoutPreferences): string {
  return JSON.stringify(preferences)
}

export function resolveViewportMode(viewportWidth: number): DesktopViewportMode {
  if (viewportWidth < DESKTOP_LAYOUT_BREAKPOINTS.inspectorDrawerBelow) return 'compact'
  if (viewportWidth < DESKTOP_LAYOUT_BREAKPOINTS.sidebarDrawerBelow) return 'sidebar-drawer'
  return 'wide'
}

/**
 * Resolves persisted pane preferences against the current viewport. When both
 * panes are inline, excess width is removed proportionally from each pane's
 * preferred space above its minimum so the conversation never drops below its
 * minimum width.
 */
export function resolvePaneWidths(
  viewportWidth: number,
  preferredSidebar: number,
  preferredInspector: number,
): ResolvedPaneWidths {
  let sidebar = clamp(preferredSidebar, DESKTOP_LAYOUT.sidebar.min, DESKTOP_LAYOUT.sidebar.max)
  let inspector = clamp(
    preferredInspector,
    DESKTOP_LAYOUT.inspector.min,
    DESKTOP_LAYOUT.inspector.max,
  )
  const paneBudget =
    viewportWidth - DESKTOP_LAYOUT.conversation.min - DESKTOP_LAYOUT.resizeHandleWidth * 2
  const overflow = sidebar + inspector - paneBudget
  if (overflow <= 0) return { sidebar, inspector }

  const sidebarCapacity = sidebar - DESKTOP_LAYOUT.sidebar.min
  const inspectorCapacity = inspector - DESKTOP_LAYOUT.inspector.min
  const totalCapacity = sidebarCapacity + inspectorCapacity
  if (totalCapacity <= 0) {
    return { sidebar: DESKTOP_LAYOUT.sidebar.min, inspector: DESKTOP_LAYOUT.inspector.min }
  }

  const sidebarShrink = Math.min(sidebarCapacity, overflow * (sidebarCapacity / totalCapacity))
  sidebar -= sidebarShrink
  inspector -= overflow - sidebarShrink
  if (inspector < DESKTOP_LAYOUT.inspector.min) {
    sidebar -= DESKTOP_LAYOUT.inspector.min - inspector
    inspector = DESKTOP_LAYOUT.inspector.min
  }
  if (sidebar < DESKTOP_LAYOUT.sidebar.min) {
    inspector -= DESKTOP_LAYOUT.sidebar.min - sidebar
    sidebar = DESKTOP_LAYOUT.sidebar.min
  }
  return { sidebar: Math.round(sidebar), inspector: Math.round(inspector) }
}

export function sidebarMaximumForViewport(viewportWidth: number, inspectorWidth: number): number {
  return clamp(
    viewportWidth -
      inspectorWidth -
      DESKTOP_LAYOUT.conversation.min -
      DESKTOP_LAYOUT.resizeHandleWidth * 2,
    DESKTOP_LAYOUT.sidebar.min,
    DESKTOP_LAYOUT.sidebar.max,
  )
}

export function inspectorMaximumForViewport(viewportWidth: number, sidebarWidth: number): number {
  return clamp(
    viewportWidth -
      sidebarWidth -
      DESKTOP_LAYOUT.conversation.min -
      DESKTOP_LAYOUT.resizeHandleWidth * 2,
    DESKTOP_LAYOUT.inspector.min,
    DESKTOP_LAYOUT.inspector.max,
  )
}
