import type { ReactElement, ReactNode } from 'react'

/** Presentation boundary for Team models, workflow policy, planner, and memory. */
export function TeamSurface({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="workers-panel" id="team-panel" role="tabpanel" aria-labelledby="team-tab">
      {children}
    </div>
  )
}
