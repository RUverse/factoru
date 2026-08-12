import type { ReactElement, ReactNode } from 'react'

/** Presentation boundary for the existing four-state task workflow. */
export function TasksSurface({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="task-board" id="tasks-panel" role="tabpanel" aria-labelledby="tasks-tab">
      {children}
    </div>
  )
}
