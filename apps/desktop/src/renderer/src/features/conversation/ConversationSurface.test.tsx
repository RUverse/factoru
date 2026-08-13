// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@factoru/protocol'
import { ConversationSurface } from './ConversationSurface'

let mounted: { root: ReturnType<typeof createRoot>; container: HTMLDivElement } | null = null

beforeEach(() => {
  Object.defineProperty(window, 'factoru', {
    configurable: true,
    value: {
      product: {
        subscribeImageUploadProgress: vi.fn(() => () => undefined),
      },
    },
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: true })),
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  if (mounted) act(() => mounted!.root.unmount())
  mounted?.container.remove()
  mounted = null
})

describe('ConversationSurface', () => {
  it('keeps the new chat action available while viewing archived chat history', async () => {
    const now = '2026-08-13T10:00:00.000Z'
    const conversation = {
      id: 'conversation_1',
      status: 'ready',
      error: null,
      messages: [],
      transcriptCursor: 0,
      streamCursor: 0,
      hasMoreHistory: false,
      activeTurnId: null,
      contextRevision: 2,
      contextStartedAt: now,
      canResetContext: true,
      contexts: [
        {
          revision: 2,
          startedAt: now,
          messageCount: 0,
          preview: null,
          current: true,
        },
        {
          revision: 1,
          startedAt: '2026-08-12T10:00:00.000Z',
          messageCount: 1,
          preview: 'Earlier request',
          current: false,
        },
      ],
      updatedAt: now,
    } satisfies Workspace['conversation']
    const onNewChat = vi.fn()
    const onLoadContext = vi.fn().mockResolvedValue({
      conversationId: conversation.id,
      contextRevision: 1,
      messages: [],
      nextBefore: null,
      hasMore: false,
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted = { root, container }

    act(() =>
      root.render(
        <ConversationSurface
          project={{ factoryId: 'factory_1', projectId: 'project_1' }}
          conversation={conversation}
          messages={conversation.messages}
          draft=""
          connected
          busy={false}
          onDraftChange={vi.fn()}
          onSend={vi.fn().mockResolvedValue(true)}
          onStop={vi.fn().mockResolvedValue(undefined)}
          onRetry={vi.fn().mockResolvedValue(undefined)}
          onLoadHistory={vi.fn().mockResolvedValue(undefined)}
          onLoadContext={onLoadContext}
          onNewChat={onNewChat}
        />,
      ),
    )

    const selector = container.querySelector('[aria-label="Chat history"]') as HTMLSelectElement
    selector.value = '1'
    await act(async () => selector.dispatchEvent(new Event('change', { bubbles: true })))

    expect(onLoadContext).toHaveBeenCalledWith(1)
    expect(container.textContent).toContain('Read-only')
    const newChat = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'New chat',
    )
    expect(newChat).toBeTruthy()
    act(() => newChat!.click())
    expect(onNewChat).toHaveBeenCalledOnce()
  })
})
