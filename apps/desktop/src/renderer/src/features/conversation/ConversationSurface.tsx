import { PromptComposer } from '@factoru/ui'
import type { ConversationMessage } from '@factoru/protocol'
import type { ReactElement } from 'react'

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

export function ConversationSurface({
  messages,
  draft,
  connected,
  busy,
  onDraftChange,
  onSend,
}: {
  messages: readonly ConversationMessage[]
  draft: string
  connected: boolean
  busy: boolean
  onDraftChange: (value: string) => void
  onSend: (value: string) => void
}): ReactElement {
  return (
    <>
      <div className="message-list" aria-live="polite">
        {messages.length === 0 ? (
          <section className="conversation-empty">
            <span className="avatar">PM</span>
            <h2>What should we work on?</h2>
            <p>
              Discuss the repository, clarify a direction, or ask the Project Manager to help shape
              the next task.
            </p>
          </section>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <header>
                <strong>{message.role === 'assistant' ? 'Project Manager' : 'You'}</strong>
                <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
              </header>
              <p>{message.text}</p>
              <footer>
                {statusLabel(message.deliveryState)}
                {message.tokenUsage &&
                  ` · ${message.tokenUsage.input + message.tokenUsage.output} tokens`}
                {message.toolActivity.length > 0 &&
                  ` · ${message.toolActivity.length} tool activities`}
              </footer>
            </article>
          ))
        )}
      </div>
      <div className="composer">
        <PromptComposer
          value={draft}
          onValueChange={onDraftChange}
          onSubmit={onSend}
          maxLength={32_000}
          disabled={!connected}
          busy={busy}
        />
      </div>
    </>
  )
}
