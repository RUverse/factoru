// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { LAYOUT_PREFERENCES_KEY } from './layout-config'
import { useDesktopLayout } from './use-desktop-layout'

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
  window.localStorage.clear()
})

describe('useDesktopLayout', () => {
  it('hydrates and persists the explicit sidebar collapsed preference', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 1280,
    })
    window.localStorage.setItem(
      LAYOUT_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        sidebarWidth: 256,
        inspectorWidth: 420,
        sidebarCollapsed: true,
      }),
    )
    const observed: boolean[] = []
    function Fixture(): React.JSX.Element {
      const layout = useDesktopLayout()
      useEffect(() => {
        observed.push(layout.sidebarCollapsed)
      }, [layout.sidebarCollapsed])
      return <button onClick={layout.toggleSidebar}>{String(layout.sidebarCollapsed)}</button>
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    act(() => root.render(<Fixture />))
    expect(container.querySelector('button')?.textContent).toBe('true')
    act(() => container.querySelector('button')?.click())
    expect(container.querySelector('button')?.textContent).toBe('false')
    expect(JSON.parse(window.localStorage.getItem(LAYOUT_PREFERENCES_KEY) ?? '{}')).toMatchObject({
      sidebarCollapsed: false,
    })
    expect(observed).toEqual([true, false])
  })
})
