import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { DesktopLayoutState } from '../layout/use-desktop-layout'

export function DesktopShell({
  layout,
  windowState,
  projectSetupOpen,
  children,
}: {
  layout: DesktopLayoutState
  windowState: { platform: 'darwin' | 'win32' | 'linux'; fullScreen: boolean }
  projectSetupOpen: boolean
  children: ReactNode
}): ReactElement {
  return (
    <main
      className={`workspace-shell ${projectSetupOpen ? 'project-setup-open' : ''}`}
      data-platform={windowState.platform}
      data-fullscreen={windowState.fullScreen}
      data-mode={layout.mode}
      data-sidebar-collapsed={layout.sidebarCollapsed}
      style={
        {
          '--factoru-sidebar-width': `${layout.sidebarWidth}px`,
          '--factoru-inspector-width': `${layout.inspectorWidth}px`,
        } as CSSProperties
      }
    >
      {children}
    </main>
  )
}
