import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT_PREFERENCES,
  DESKTOP_LAYOUT,
  DESKTOP_LAYOUT_BREAKPOINTS,
  parseLayoutPreferences,
  resolvePaneWidths,
  resolveViewportMode,
} from './layout-config'

describe('desktop layout policy', () => {
  it('parses, versions, and clamps persisted preferences', () => {
    expect(parseLayoutPreferences(null)).toEqual(DEFAULT_LAYOUT_PREFERENCES)
    expect(parseLayoutPreferences('{broken')).toEqual(DEFAULT_LAYOUT_PREFERENCES)
    expect(parseLayoutPreferences('{"version":2}')).toEqual(DEFAULT_LAYOUT_PREFERENCES)
    expect(
      parseLayoutPreferences(
        JSON.stringify({
          version: 1,
          sidebarWidth: 20,
          inspectorWidth: 900,
          sidebarCollapsed: true,
        }),
      ),
    ).toEqual({
      version: 1,
      sidebarWidth: DESKTOP_LAYOUT.sidebar.min,
      inspectorWidth: DESKTOP_LAYOUT.inspector.max,
      sidebarCollapsed: true,
    })
  })

  it('derives responsive modes from the layout constants', () => {
    expect(resolveViewportMode(DESKTOP_LAYOUT_BREAKPOINTS.sidebarDrawerBelow)).toBe('wide')
    expect(resolveViewportMode(DESKTOP_LAYOUT_BREAKPOINTS.sidebarDrawerBelow - 1)).toBe(
      'sidebar-drawer',
    )
    expect(resolveViewportMode(DESKTOP_LAYOUT_BREAKPOINTS.inspectorDrawerBelow - 1)).toBe('compact')
  })

  it('preserves preferred widths when the conversation minimum is safe', () => {
    expect(resolvePaneWidths(1_280, 256, 420)).toEqual({ sidebar: 256, inspector: 420 })
  })

  it('shrinks both panes proportionally above their minimums', () => {
    expect(resolvePaneWidths(1_200, 360, 640)).toEqual({ sidebar: 269, inspector: 449 })
    const widths = resolvePaneWidths(1_010, 360, 640)
    expect(widths).toEqual({ sidebar: 208, inspector: 320 })
    expect(
      widths.sidebar +
        widths.inspector +
        DESKTOP_LAYOUT.conversation.min +
        DESKTOP_LAYOUT.resizeHandleWidth * 2,
    ).toBeLessThanOrEqual(1_010)
  })

  it('keeps reset defaults in the exported configuration', () => {
    expect(DEFAULT_LAYOUT_PREFERENCES.sidebarWidth).toBe(DESKTOP_LAYOUT.sidebar.default)
    expect(DEFAULT_LAYOUT_PREFERENCES.inspectorWidth).toBe(DESKTOP_LAYOUT.inspector.default)
  })
})
