import { Drawer } from '@factoru/ui'
import type { ReactElement, ReactNode } from 'react'

export function ResponsivePane({
  drawer,
  open,
  onOpenChange,
  side,
  title,
  width,
  visible = true,
  children,
}: {
  drawer: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  side: 'left' | 'right'
  title: string
  width: number
  visible?: boolean
  children: ReactNode
}): ReactElement | null {
  if (!visible) return null
  if (!drawer) return <>{children}</>
  return (
    <Drawer open={open} onOpenChange={onOpenChange} side={side} title={title} width={width}>
      {children}
    </Drawer>
  )
}
