import type { ReactElement, ReactNode } from 'react'

export function OnboardingCard({
  headingId,
  children,
}: {
  headingId: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="onboarding-card" aria-labelledby={headingId}>
      {children}
    </section>
  )
}
