import type { ReactElement, ReactNode } from 'react'

export function ProjectSetupSurface({ children }: { children: ReactNode }): ReactElement {
  return <section className="setup-panel">{children}</section>
}
