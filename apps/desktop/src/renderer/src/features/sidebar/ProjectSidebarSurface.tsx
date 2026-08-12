import type { ReactElement, ReactNode } from 'react'

export function ProjectSidebarSurface({ children }: { children: ReactNode }): ReactElement {
  return <aside className="sidebar">{children}</aside>
}
