import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Drawer, PromptComposer, ResizeHandle, Tabs } from './components'

describe('Tabs', () => {
  it('exposes an accessible tab list and selects panels with the keyboard', async () => {
    const user = userEvent.setup()
    render(
      <Tabs
        ariaLabel="Workspace sections"
        items={[
          { value: 'tasks', label: 'Tasks', panel: 'Task panel' },
          { value: 'team', label: 'Team', panel: 'Team panel' },
        ]}
      />,
    )
    expect(screen.getByRole('tablist', { name: 'Workspace sections' })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Team' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Team panel')
  })
})

describe('ResizeHandle', () => {
  function Fixture(): React.JSX.Element {
    const [value, setValue] = useState(256)
    return (
      <ResizeHandle
        label="Resize sidebar"
        value={value}
        min={208}
        max={360}
        defaultValue={256}
        onValueChange={setValue}
      />
    )
  }

  it('supports keyboard resize and reset', () => {
    render(<Fixture />)
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle).toHaveAttribute('aria-valuenow', '264')
    fireEvent.keyDown(handle, { key: 'End' })
    expect(handle).toHaveAttribute('aria-valuenow', '360')
    fireEvent.doubleClick(handle)
    expect(handle).toHaveAttribute('aria-valuenow', '256')
  })

  it('supports pointer resizing and clamps at the maximum', () => {
    render(<Fixture />)
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 })
    expect(handle).toHaveAttribute('aria-valuenow', '360')
    fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 })
  })
})

describe('Drawer', () => {
  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    function Fixture(): React.JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open navigation</button>
          <Drawer open={open} onOpenChange={setOpen} title="Project navigation">
            <button>Drawer action</button>
          </Drawer>
        </>
      )
    }
    render(<Fixture />)
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Project navigation' })).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Project navigation' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('PromptComposer', () => {
  function Composer({
    onSubmit = vi.fn(),
  }: {
    onSubmit?: (value: string) => void
  }): React.JSX.Element {
    const [value, setValue] = useState('')
    return <PromptComposer value={value} onValueChange={setValue} onSubmit={onSubmit} />
  }

  it('sends on Enter and inserts a newline with Shift+Enter', () => {
    const onSubmit = vi.fn()
    render(<Composer onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Build the shell' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('Build the shell')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not submit while an IME composition is active', () => {
    const onSubmit = vi.fn()
    render(<Composer onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '入力' } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows honest disabled future affordances', () => {
    render(<Composer />)
    expect(screen.getByRole('button', { name: 'Attach files (coming later)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start dictation (coming later)' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Project Manager model selection (coming later)' }),
    ).toBeDisabled()
  })

  it('keeps the draft read-only while a send is busy', () => {
    render(<PromptComposer value="Sending" onValueChange={vi.fn()} onSubmit={vi.fn()} busy />)
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sending message' })).toBeDisabled()
  })
})
