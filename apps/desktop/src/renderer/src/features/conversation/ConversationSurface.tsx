import { PromptComposer } from '@factoru/ui'
import type { Artifact, ConversationMessage, Workspace } from '@factoru/protocol'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { ProjectRef } from '../../../../shared/product'

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

type PendingImage = {
  uploadId: string
  file: File
  previewUrl: string
  state: 'uploading' | 'ready' | 'failed'
  artifact?: Artifact
  error?: string
  provenance: 'picker' | 'paste' | 'drop'
  progress: number
}

function safeHref(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function inlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/g)
  return tokens.map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`'))
      return <code key={index}>{token.slice(1, -1)}</code>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
    if (link) {
      const href = safeHref(link[2]!)
      return href ? (
        <a key={index} href={href} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      ) : (
        link[1]
      )
    }
    return token
  })
}

function Markdown({ text }: { text: string }): ReactElement {
  const sections = text.split(/(```[\s\S]*?```)/g).filter(Boolean)
  return (
    <div className="message-markdown">
      {sections.map((section, sectionIndex) => {
        if (section.startsWith('```')) {
          const body = section.slice(3, -3).replace(/^[^\n]*\n/, '')
          return (
            <pre key={sectionIndex}>
              <code>{body}</code>
            </pre>
          )
        }
        const lines = section.split('\n')
        const nodes: ReactNode[] = []
        for (let index = 0; index < lines.length;) {
          const line = lines[index]!
          if (line.startsWith('- ')) {
            const items: string[] = []
            while (lines[index]?.startsWith('- ')) items.push(lines[index++]!.slice(2))
            nodes.push(
              <ul key={`ul-${index}`}>
                {items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inlineMarkdown(item)}</li>
                ))}
              </ul>,
            )
            continue
          }
          if (line.includes('|') && lines[index + 1]?.match(/^\s*\|?\s*:?-+/)) {
            const rows: string[][] = []
            rows.push(
              line
                .split('|')
                .map((cell) => cell.trim())
                .filter(Boolean),
            )
            index += 2
            while (lines[index]?.includes('|'))
              rows.push(
                lines[index++]!.split('|')
                  .map((cell) => cell.trim())
                  .filter(Boolean),
              )
            nodes.push(
              <table key={`table-${index}`}>
                <thead>
                  <tr>
                    {rows[0]!.map((cell, cellIndex) => (
                      <th key={cellIndex}>{inlineMarkdown(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{inlineMarkdown(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>,
            )
            continue
          }
          if (line.trim()) nodes.push(<p key={`p-${index}`}>{inlineMarkdown(line)}</p>)
          index += 1
        }
        return <div key={sectionIndex}>{nodes}</div>
      })}
    </div>
  )
}

function ArtifactImage({
  project,
  artifact,
}: {
  project: ProjectRef
  artifact: Artifact
}): ReactElement {
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    void window.factoru.product
      .loadImage(project, artifact.conversationId, artifact.id)
      .then((result) => {
        if (!active) return
        const copy = new Uint8Array(result.bytes)
        objectUrl = URL.createObjectURL(new Blob([copy.buffer], { type: result.mimeType }))
        setSource(objectUrl)
      })
      .catch(() => setSource(null))
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [artifact.conversationId, artifact.id, project.factoryId, project.projectId])
  return source ? (
    <img
      className="message-image"
      src={source}
      alt={artifact.fileName}
      width={artifact.width}
      height={artifact.height}
    />
  ) : (
    <div className="message-image-placeholder" role="status">
      Loading {artifact.fileName}…
    </div>
  )
}

export function ConversationSurface({
  project,
  conversation,
  messages,
  draft,
  connected,
  busy,
  onDraftChange,
  onSend,
  onStop,
  onRetry,
  onLoadHistory,
}: {
  project: ProjectRef
  conversation: Workspace['conversation']
  messages: readonly ConversationMessage[]
  draft: string
  connected: boolean
  busy: boolean
  onDraftChange: (value: string) => void
  onSend: (value: string, artifactIds: string[]) => Promise<boolean>
  onStop: (turnId: string) => Promise<unknown>
  onRetry: (messageId: string) => Promise<unknown>
  onLoadHistory: (before?: string) => Promise<unknown>
}): ReactElement {
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const historyHeight = useRef<number | null>(null)
  const [unread, setUnread] = useState(0)
  const [images, setImages] = useState<PendingImage[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const active = Boolean(conversation.activeTurnId)

  useEffect(() => {
    const element = list.current
    if (!element) return
    if (historyHeight.current !== null) {
      element.scrollTop += element.scrollHeight - historyHeight.current
      historyHeight.current = null
      return
    }
    if (pinned.current)
      element.scrollTo({
        top: element.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    else setUnread((value) => value + 1)
  }, [messages])

  useEffect(
    () =>
      window.factoru.product.subscribeImageUploadProgress((progress) => {
        setImages((current) =>
          current.map((image) =>
            image.uploadId === progress.uploadId
              ? {
                  ...image,
                  progress: Math.round((progress.uploadedBytes / progress.totalBytes) * 100),
                }
              : image,
          ),
        )
      }),
    [],
  )

  async function upload(item: PendingImage): Promise<void> {
    try {
      const artifact = await window.factoru.product.uploadImage({
        uploadId: item.uploadId,
        project,
        conversationId: conversation.id,
        fileName: item.file.name || 'image',
        mimeType: item.file.type,
        provenance: item.provenance,
        bytes: new Uint8Array(await item.file.arrayBuffer()),
      })
      setImages((current) =>
        current.map((candidate) =>
          candidate.uploadId === item.uploadId
            ? { ...candidate, state: 'ready', artifact }
            : candidate,
        ),
      )
    } catch (error) {
      setImages((current) =>
        current.map((candidate) =>
          candidate.uploadId === item.uploadId
            ? {
                ...candidate,
                state: 'failed',
                error: error instanceof Error ? error.message : String(error),
              }
            : candidate,
        ),
      )
    }
  }

  function addFiles(
    files: FileList | readonly File[],
    provenance: PendingImage['provenance'],
  ): void {
    setAttachmentError(null)
    const accepted = Array.from(files).slice(0, Math.max(0, 4 - images.length))
    if (accepted.length < files.length)
      setAttachmentError('A message can contain at most four images.')
    for (const file of accepted) {
      if (!IMAGE_TYPES.has(file.type) || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
        setAttachmentError(
          `${file.name || 'Image'} must be PNG, JPEG, GIF, or WebP and no larger than 8 MB.`,
        )
        continue
      }
      const item: PendingImage = {
        uploadId: `upload_${crypto.randomUUID()}`,
        file,
        previewUrl: URL.createObjectURL(file),
        state: 'uploading',
        provenance,
        progress: 0,
      }
      setImages((current) => [...current, item])
      void upload(item)
    }
  }

  async function removeImage(item: PendingImage): Promise<void> {
    if (item.state === 'uploading') await window.factoru.product.cancelImageUpload(item.uploadId)
    if (item.artifact)
      await window.factoru.product.removeImage(project, conversation.id, item.artifact.id)
    URL.revokeObjectURL(item.previewUrl)
    setImages((current) => current.filter((candidate) => candidate.uploadId !== item.uploadId))
  }

  async function submit(value: string): Promise<void> {
    if (images.some((image) => image.state !== 'ready')) return
    const sent = await onSend(
      value,
      images.flatMap((image) => (image.artifact ? [image.artifact.id] : [])),
    )
    if (sent) {
      for (const image of images) URL.revokeObjectURL(image.previewUrl)
      setImages([])
    }
  }

  return (
    <>
      <div
        ref={list}
        className="message-list"
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
          if (pinned.current) setUnread(0)
        }}
      >
        {conversation.hasMoreHistory && (
          <button
            className="load-history"
            type="button"
            disabled={loadingHistory}
            onClick={() => {
              historyHeight.current = list.current?.scrollHeight ?? null
              setLoadingHistory(true)
              void onLoadHistory(messages[0]?.id).finally(() => setLoadingHistory(false))
            }}
          >
            {loadingHistory ? 'Loading earlier messages…' : 'Load earlier messages'}
          </button>
        )}
        {messages.length === 0 ? (
          <section className="conversation-empty">
            <span className="avatar">PM</span>
            <h2>What should we work on?</h2>
            <p>
              Discuss the repository, clarify a direction, or share an image to shape the next task.
            </p>
          </section>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`message ${message.role}`}
              data-state={message.state}
            >
              <header>
                <strong>{message.role === 'assistant' ? 'Project Manager' : 'You'}</strong>
                <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
              </header>
              {message.parts.length > 0 ? (
                message.parts.map((part) => {
                  if (part.type === 'text') return <Markdown key={part.id} text={part.text} />
                  if (part.type === 'image')
                    return (
                      <ArtifactImage key={part.id} project={project} artifact={part.artifact} />
                    )
                  return (
                    <details key={part.id} className="tool-operation">
                      <summary>
                        {part.tool.status === 'running' ? 'Working' : part.tool.status} ·{' '}
                        {part.tool.name}
                      </summary>
                      {part.tool.summary && <pre>{part.tool.summary}</pre>}
                    </details>
                  )
                })
              ) : (
                <Markdown text={message.text} />
              )}
              <footer>
                {message.state === 'streaming'
                  ? 'Project Manager is responding…'
                  : message.state.replaceAll('_', ' ')}
                {message.tokenUsage &&
                  ` · ${message.tokenUsage.input + message.tokenUsage.output} tokens`}
                {['failed', 'cancelled'].includes(message.state) && (
                  <button type="button" onClick={() => void onRetry(message.id)}>
                    Retry
                  </button>
                )}
              </footer>
            </article>
          ))
        )}
        {unread > 0 && (
          <button
            className="unread-messages"
            type="button"
            onClick={() => {
              list.current?.scrollTo({ top: list.current.scrollHeight })
              pinned.current = true
              setUnread(0)
            }}
          >
            {unread} new update{unread === 1 ? '' : 's'}
          </button>
        )}
      </div>
      <div
        className="composer"
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files).filter((file) =>
            IMAGE_TYPES.has(file.type),
          )
          if (files.length) {
            event.preventDefault()
            addFiles(files, 'paste')
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(event) => {
          event.preventDefault()
          addFiles(event.dataTransfer.files, 'drop')
        }}
      >
        <input
          ref={input}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={(event) => {
            if (event.currentTarget.files) addFiles(event.currentTarget.files, 'picker')
            event.currentTarget.value = ''
          }}
        />
        {images.length > 0 && (
          <div className="attachment-tray" aria-live="polite">
            {images.map((image) => (
              <div className="attachment-preview" key={image.uploadId} data-state={image.state}>
                <img src={image.previewUrl} alt="" />
                <span>
                  {image.file.name || 'Pasted image'} ·{' '}
                  {image.state === 'uploading'
                    ? `Uploading ${image.progress}%…`
                    : image.state === 'failed'
                      ? image.error
                      : 'Ready'}
                </span>
                {image.state === 'failed' && (
                  <button
                    type="button"
                    onClick={() => {
                      setImages((current) =>
                        current.map((candidate) =>
                          candidate.uploadId === image.uploadId
                            ? { ...candidate, state: 'uploading', progress: 0, error: undefined }
                            : candidate,
                        ),
                      )
                      void upload(image)
                    }}
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${image.file.name || 'image'}`}
                  onClick={() => void removeImage(image)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentError && (
          <p className="attachment-error" role="alert">
            {attachmentError}
          </p>
        )}
        <PromptComposer
          value={draft}
          onValueChange={onDraftChange}
          onSubmit={(value) => void submit(value)}
          maxLength={32_000}
          disabled={!connected || images.some((image) => image.state !== 'ready')}
          busy={busy || active}
          onAttach={() => input.current?.click()}
          onStop={
            conversation.activeTurnId ? () => void onStop(conversation.activeTurnId!) : undefined
          }
          canSubmitEmpty={images.some((image) => image.state === 'ready')}
        />
      </div>
    </>
  )
}
