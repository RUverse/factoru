import { IconButton, PanelRightIcon } from '@factoru/ui'
import type { ReactElement } from 'react'

export function InspectorTabs({
  value,
  compact,
  onValueChange,
  onClose,
}: {
  value: 'tasks' | 'team'
  compact: boolean
  onValueChange: (value: 'tasks' | 'team') => void
  onClose: () => void
}): ReactElement {
  return (
    <header className="inspector-tabs" role="tablist" aria-label="Project workspace">
      <button
        role="tab"
        aria-selected={value === 'tasks'}
        aria-controls="tasks-panel"
        id="tasks-tab"
        className={value === 'tasks' ? 'active' : ''}
        onClick={() => onValueChange('tasks')}
      >
        Tasks
      </button>
      <button
        role="tab"
        aria-selected={value === 'team'}
        aria-controls="team-panel"
        id="team-tab"
        className={value === 'team' ? 'active' : ''}
        onClick={() => onValueChange('team')}
      >
        Team
      </button>
      {compact && (
        <IconButton
          className="inspector-drawer-close"
          aria-label="Close tasks and team inspector"
          onClick={onClose}
        >
          <PanelRightIcon size={15} aria-hidden="true" />
        </IconButton>
      )}
    </header>
  )
}
