import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { ArrowUp, Mic, Paperclip, Square } from 'lucide-react'

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, type = 'button', variant = 'secondary', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classes('fui-button', className)}
      data-variant={variant}
      {...props}
    />
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps>(function IconButton(
  { className, type = 'button', ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={classes('fui-icon-button', className)} {...props} />
  )
})

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'accent'
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps): ReactElement {
  return <span className={classes('fui-badge', className)} data-tone={tone} {...props} />
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={classes('fui-card', className)} {...props} />
}

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
}

export function Field({
  className,
  label,
  htmlFor,
  hint,
  children,
  ...props
}: FieldProps): ReactElement {
  return (
    <div className={classes('fui-field', className)} {...props}>
      <label className="fui-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className="fui-field-hint">{hint}</span> : null}
    </div>
  )
}

export interface TabItem {
  value: string
  label: ReactNode
  panel: ReactNode
}

export interface TabsProps {
  items: readonly TabItem[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  ariaLabel: string
  className?: string
}

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  ariaLabel,
  className,
}: TabsProps): ReactElement {
  return (
    <BaseTabs.Root
      className={className}
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
    >
      <BaseTabs.List className="fui-tabs-list" aria-label={ariaLabel}>
        {items.map((item) => (
          <BaseTabs.Tab key={item.value} className="fui-tab" value={item.value}>
            {item.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="fui-tabs-indicator" />
      </BaseTabs.List>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} className="fui-tab-panel" value={item.value}>
          {item.panel}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  )
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: DialogProps): ReactElement {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fui-dialog-backdrop" />
        <BaseDialog.Popup className={classes('fui-dialog-popup', className)}>
          <BaseDialog.Title className="fui-dialog-title">{title}</BaseDialog.Title>
          {description ? (
            <BaseDialog.Description className="fui-dialog-description">
              {description}
            </BaseDialog.Description>
          ) : null}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  side?: 'left' | 'right'
  title: string
  children: ReactNode
  width?: number
}

export function Drawer({
  open,
  onOpenChange,
  side = 'left',
  title,
  children,
  width,
}: DrawerProps): ReactElement {
  const style = width ? ({ '--drawer-width': `${width}px` } as CSSProperties) : undefined
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fui-dialog-backdrop" />
        <div className="fui-drawer-positioner" data-side={side}>
          <BaseDialog.Popup className="fui-drawer-popup" style={style}>
            <BaseDialog.Title className="fui-visually-hidden">{title}</BaseDialog.Title>
            {children}
          </BaseDialog.Popup>
        </div>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export interface TooltipProps {
  label: ReactNode
  children: ReactElement
}

export function Tooltip({ label, children }: TooltipProps): ReactElement {
  return (
    <BaseTooltip.Provider delay={500}>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger render={children} />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner sideOffset={6} className="fui-tooltip-positioner">
            <BaseTooltip.Popup className="fui-tooltip-popup">{label}</BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  )
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps): ReactElement {
  return (
    <div className={classes('fui-empty-state', className)} {...props}>
      {icon}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function SplitView({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={classes('fui-split-view', className)} {...props} />
}

export interface ResizeHandleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: number
  min: number
  max: number
  defaultValue: number
  label: string
  direction?: 'positive' | 'negative'
  step?: number
  onValueChange: (value: number) => void
  onValueCommit?: (value: number) => void
}

export function ResizeHandle({
  value,
  min,
  max,
  defaultValue,
  label,
  direction = 'positive',
  step = 8,
  onValueChange,
  onValueCommit,
  className,
  ...props
}: ResizeHandleProps): ReactElement {
  const drag = useRef<{ startX: number; startValue: number } | null>(null)
  const [resizing, setResizing] = useState(false)
  const currentValue = useRef(value)
  currentValue.current = value

  const clampValue = useCallback(
    (next: number) => Math.round(Math.min(max, Math.max(min, next))),
    [max, min],
  )

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    drag.current = { startX: event.clientX, startValue: value }
    setResizing(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!drag.current) return
    const multiplier = direction === 'positive' ? 1 : -1
    onValueChange(
      clampValue(drag.current.startValue + (event.clientX - drag.current.startX) * multiplier),
    )
  }

  function finishPointerResize(event: PointerEvent<HTMLDivElement>): void {
    if (!drag.current) return
    drag.current = null
    setResizing(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    onValueCommit?.(currentValue.current)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const multiplier = direction === 'positive' ? 1 : -1
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = value - step * multiplier * (event.shiftKey ? 4 : 1)
    if (event.key === 'ArrowRight') next = value + step * multiplier * (event.shiftKey ? 4 : 1)
    if (event.key === 'Home') next = min
    if (event.key === 'End') next = max
    if (next === null) return
    event.preventDefault()
    const clamped = clampValue(next)
    onValueChange(clamped)
    onValueCommit?.(clamped)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className={classes('fui-resize-handle', className)}
      data-resizing={resizing}
      onDoubleClick={() => {
        const next = clampValue(defaultValue)
        onValueChange(next)
        onValueCommit?.(next)
      }}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointerResize}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerResize}
      {...props}
    />
  )
}

export interface PromptComposerProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'value' | 'onSubmit'
> {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  busy?: boolean
  modelLabel?: string
  leadingActions?: ReactNode
  trailingActions?: ReactNode
  onAttach?: () => void
  onStop?: () => void
  canSubmitEmpty?: boolean
}

export const PromptComposer = forwardRef<HTMLTextAreaElement, PromptComposerProps>(
  function PromptComposer(
    {
      value,
      onValueChange,
      onSubmit,
      disabled = false,
      busy = false,
      modelLabel = 'Project Manager',
      leadingActions,
      trailingActions,
      onAttach,
      onStop,
      canSubmitEmpty = false,
      placeholder = 'Message Project Manager…',
      ...textareaProps
    },
    forwardedRef,
  ) {
    const localRef = useRef<HTMLTextAreaElement | null>(null)
    const composing = useRef(false)

    const setRef = useCallback(
      (element: HTMLTextAreaElement | null) => {
        localRef.current = element
        if (typeof forwardedRef === 'function') forwardedRef(element)
        else if (forwardedRef) forwardedRef.current = element
      },
      [forwardedRef],
    )

    useEffect(() => {
      const element = localRef.current
      if (!element) return
      element.style.height = 'auto'
      element.style.height = `${Math.min(element.scrollHeight, 180)}px`
    }, [value])

    const canSend = !disabled && !busy && (value.trim().length > 0 || canSubmitEmpty)
    function submit(): void {
      if (canSend) onSubmit(value.trim())
    }

    return (
      <div className="fui-prompt-composer" data-disabled={disabled || busy}>
        <textarea
          {...textareaProps}
          ref={setRef}
          className={classes('fui-prompt-textarea', textareaProps.className)}
          value={value}
          disabled={disabled || busy}
          placeholder={placeholder}
          rows={1}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onKeyDown={(event) => {
            if (
              event.key !== 'Enter' ||
              event.shiftKey ||
              composing.current ||
              event.nativeEvent.isComposing
            )
              return
            event.preventDefault()
            submit()
          }}
        />
        <div className="fui-prompt-toolbar">
          <Tooltip label={onAttach ? 'Attach images' : 'Attachments unavailable'}>
            <IconButton
              disabled={!onAttach || disabled || busy}
              aria-label="Attach images"
              onClick={onAttach}
            >
              <Paperclip size={15} aria-hidden="true" />
            </IconButton>
          </Tooltip>
          {leadingActions}
          <div className="fui-prompt-actions">
            {trailingActions}
            <Button
              className="fui-prompt-model"
              variant="ghost"
              disabled
              aria-label={`${modelLabel} model selection (coming later)`}
            >
              {modelLabel}
            </Button>
            <Tooltip label="Dictation is coming later">
              <IconButton disabled aria-label="Start dictation (coming later)">
                <Mic size={15} aria-hidden="true" />
              </IconButton>
            </Tooltip>
            {busy && onStop ? (
              <IconButton className="fui-prompt-send" aria-label="Stop response" onClick={onStop}>
                <Square size={13} aria-hidden="true" />
              </IconButton>
            ) : (
              <IconButton
                className="fui-prompt-send"
                aria-label={busy ? 'Sending message' : 'Send message'}
                disabled={!canSend}
                onClick={submit}
              >
                <ArrowUp size={15} aria-hidden="true" />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    )
  },
)
