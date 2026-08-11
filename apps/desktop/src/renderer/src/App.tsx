import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ProjectPreview, Task, TrustedDevice, WorkerType } from '@factoru/protocol'
import type { ProductSnapshot } from '../../shared/product'

type Root = { id: string; label: string }
type Entry = { name: string; relativePath: string; kind: 'directory' | 'repository' }
type RepositoryDraft =
  | { id: string; kind: 'local'; preview: ProjectPreview }
  | { id: string; kind: 'remote'; rootId: string; url: string }

const taskColumns = [
  ['backlog', 'Backlog'],
  ['queue', 'Queue'],
  ['in_progress', 'In progress'],
  ['needs_you', 'Needs you'],
] as const

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

export function App() {
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'tasks' | 'workers'>('tasks')
  const [showPairing, setShowPairing] = useState(false)
  const [showProjectSetup, setShowProjectSetup] = useState(false)
  const [connectionType, setConnectionType] = useState<'local' | 'remote'>('local')
  const [serverUrl, setServerUrl] = useState('https://')
  const [roots, setRoots] = useState<Root[]>([])
  const [rootId, setRootId] = useState('')
  const [directory, setDirectory] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [preview, setPreview] = useState<ProjectPreview | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [repositoryDrafts, setRepositoryDrafts] = useState<RepositoryDraft[]>([])
  const [showServerBrowser, setShowServerBrowser] = useState(false)
  const [devices, setDevices] = useState<TrustedDevice[]>([])

  useEffect(() => {
    let active = true
    void window.factoru.product.get().then((value) => active && setSnapshot(value))
    const unsubscribe = window.factoru.product.subscribe(setSnapshot)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const activeProject = useMemo(
    () => snapshot?.projects.find((project) => project.id === snapshot.activeProjectId) ?? null,
    [snapshot],
  )

  const run = async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await operation()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const pair = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(() =>
      window.factoru.product.pair(
        String(data.get('url')),
        String(data.get('code')).toUpperCase(),
        String(data.get('deviceName')),
      ),
    ).then((value) => {
      if (value) {
        setSnapshot(value)
        setShowPairing(false)
      }
    })
  }

  const pairLocal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(() => window.factoru.product.pairLocal(String(data.get('deviceName')))).then(
      (value) => {
        if (value) {
          setSnapshot(value)
          setShowPairing(false)
        }
      },
    )
  }

  const loadRoots = async () => {
    const loaded = await run(() => window.factoru.product.roots())
    if (!loaded) return
    setRoots(loaded)
    const first = loaded[0]?.id ?? ''
    setRootId(first)
    setDirectory('')
    setEntries(first ? ((await run(() => window.factoru.product.browse(first, ''))) ?? []) : [])
    setProjectName('')
    setProjectDescription('')
    setRepositoryUrl('')
    setRepositoryDrafts([])
    setPreview(null)
    setShowServerBrowser(false)
    setShowProjectSetup(true)
  }

  const browse = async (nextRoot: string, nextDirectory: string) => {
    setRootId(nextRoot)
    setDirectory(nextDirectory)
    setPreview(null)
    setEntries((await run(() => window.factoru.product.browse(nextRoot, nextDirectory))) ?? [])
  }

  const addPreview = (value: ProjectPreview) => {
    if (!value.safe) {
      setPreview(value)
      return
    }
    setRepositoryDrafts((current) => {
      if (
        current.some(
          (draft) =>
            draft.kind === 'local' &&
            draft.preview.rootId === value.rootId &&
            draft.preview.relativePath === value.relativePath,
        )
      ) {
        return current
      }
      return [
        ...current,
        { id: `local:${value.rootId}:${value.relativePath}`, kind: 'local', preview: value },
      ]
    })
    setProjectName((current) => current || value.suggestedName)
    setPreview(null)
  }

  const chooseRepositoryFolder = () => {
    void run(() => window.factoru.product.chooseRepositoryFolder()).then((value) => {
      if (value) addPreview(value)
    })
  }

  const addRepositoryUrl = () => {
    const url = repositoryUrl.trim()
    if (!url || !rootId) return
    setRepositoryDrafts((current) =>
      current.some((draft) => draft.kind === 'remote' && draft.url === url)
        ? current
        : [...current, { id: `remote:${url}`, kind: 'remote', rootId, url }],
    )
    if (!projectName) {
      const suggested =
        url
          .split('/')
          .at(-1)
          ?.replace(/\.git$/, '') ?? ''
      setProjectName(suggested)
    }
    setRepositoryUrl('')
  }

  const createProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (repositoryDrafts.length === 0) return
    void run(() =>
      window.factoru.product.create({
        name: projectName.trim(),
        description: projectDescription.trim() || undefined,
        repositories: repositoryDrafts.map((draft) =>
          draft.kind === 'local'
            ? {
                kind: 'local' as const,
                rootId: draft.preview.rootId,
                relativePath: draft.preview.relativePath,
                defaultBranch: draft.preview.defaultBranch,
                fingerprint: draft.preview.fingerprint,
              }
            : {
                kind: 'remote' as const,
                rootId: draft.rootId,
                url: draft.url,
              },
        ),
      }),
    ).then((created) => {
      if (created) {
        setShowProjectSetup(false)
        setPreview(null)
        setRepositoryDrafts([])
      }
    })
  }

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!snapshot?.activeProjectId) return
    const form = event.currentTarget
    const data = new FormData(form)
    const text = String(data.get('message')).trim()
    if (!text) return
    void run(() => window.factoru.product.sendMessage(snapshot.activeProjectId!, text)).then(
      (sent) => sent && form.reset(),
    )
  }

  const updateModel = (
    event: FormEvent<HTMLFormElement>,
    worker: WorkerType,
    slot: WorkerType['modelBindings'][number]['slot'],
  ) => {
    event.preventDefault()
    if (!snapshot?.activeProjectId) return
    const data = new FormData(event.currentTarget)
    const provider = String(data.get('provider')).trim()
    const model = String(data.get('model')).trim()
    void run(() =>
      window.factoru.product.updateModel({
        projectId: snapshot.activeProjectId!,
        workerTypeKind: worker.kind,
        slot,
        provider: provider || null,
        model: model || null,
      }),
    )
  }

  const addMemory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!snapshot?.activeProjectId) return
    const form = event.currentTarget
    const data = new FormData(form)
    void run(() =>
      window.factoru.product.addMemory({
        projectId: snapshot.activeProjectId!,
        scope: String(data.get('scope')) as 'project' | 'worker_type',
        workerTypeKind:
          data.get('scope') === 'worker_type'
            ? (String(data.get('workerTypeKind')) as WorkerType['kind'])
            : undefined,
        content: String(data.get('content')),
        provenanceRef: 'desktop:workers-memory-editor',
      }),
    ).then((value) => value && form.reset())
  }

  const createTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!snapshot?.activeProjectId) return
    const form = event.currentTarget
    const data = new FormData(form)
    void run(() =>
      window.factoru.product.createTask({
        projectId: snapshot.activeProjectId!,
        title: String(data.get('title')),
        description: String(data.get('description') || '') || undefined,
        status: String(data.get('status')) as 'backlog' | 'queue',
      }),
    ).then((value) => value && form.reset())
  }

  const updateTask = (event: FormEvent<HTMLFormElement>, task: Task) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(() =>
      window.factoru.product.updateTask({
        projectId: task.projectId,
        taskId: task.id,
        title: String(data.get('title')),
        description: String(data.get('description')),
        priority: Number(data.get('priority')),
      }),
    )
  }

  const moveTask = (event: FormEvent<HTMLFormElement>, task: Task) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const status = String(data.get('status')) as Task['status']
    void run(() =>
      window.factoru.product.moveTask({
        projectId: task.projectId,
        taskId: task.id,
        status,
        needsYouAction:
          status === 'needs_you'
            ? (String(data.get('needsYouAction')) as NonNullable<Task['needsYouAction']>)
            : undefined,
        needsYouMessage: status === 'needs_you' ? String(data.get('needsYouMessage')) : undefined,
      }),
    )
  }

  const queueTask = (task: Task) =>
    run(() =>
      window.factoru.product.moveTask({
        projectId: task.projectId,
        taskId: task.id,
        status: 'queue',
      }),
    )

  const resolveTask = (event: FormEvent<HTMLFormElement>, task: Task) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const resolution = String(data.get('resolution')) as 'accepted' | 'rejected' | 'cancelled'
    const summary = String(data.get('summary')).trim()
    if (
      !window.confirm(`${statusLabel(resolution)} “${task.title}” and remove it from the board?`)
    ) {
      return
    }
    void run(() =>
      window.factoru.product.resolveTask({
        projectId: task.projectId,
        taskId: task.id,
        resolution,
        summary,
      }),
    )
  }

  if (!snapshot) return <main className="startup muted">Starting Factoru Desktop…</main>

  if (snapshot.profiles.length === 0 || showPairing) {
    return (
      <main className="onboarding">
        <section className="onboarding-card" aria-labelledby="connect-heading">
          <div className="brand-mark" aria-hidden="true">
            F
          </div>
          <p className="eyebrow">Factoru Desktop</p>
          <h1 id="connect-heading">Connect to your development team</h1>
          <p className="muted">
            Pair with the Factoru Server that owns your repositories, workers, and project history.
          </p>
          <div className="segmented" role="group" aria-label="Connection type">
            <button
              type="button"
              className={connectionType === 'local' ? 'active' : ''}
              aria-pressed={connectionType === 'local'}
              onClick={() => {
                setConnectionType('local')
                setError(null)
              }}
            >
              This device
            </button>
            <button
              type="button"
              className={connectionType === 'remote' ? 'active' : ''}
              aria-pressed={connectionType === 'remote'}
              onClick={() => {
                setConnectionType('remote')
                setError(null)
              }}
            >
              Remote server
            </button>
          </div>
          {connectionType === 'local' ? (
            <>
              <div className="local-intro">
                <strong>Connect to Factoru Server on this computer</strong>
                <p className="muted">
                  No address or pairing code needed. Start the server and Factoru will discover it
                  securely.
                </p>
              </div>
              <form className="form-stack" onSubmit={pairLocal}>
                <label>
                  Device name
                  <input name="deviceName" required defaultValue="My Mac" />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? 'Connecting…' : 'Connect on this device'}
                </button>
              </form>
            </>
          ) : (
            <>
              <form className="form-stack" onSubmit={pair}>
                <label>
                  Server address
                  <input
                    name="url"
                    type="url"
                    required
                    value={serverUrl}
                    onChange={(event) => setServerUrl(event.target.value)}
                  />
                </label>
                <label>
                  One-time pairing code
                  <input
                    name="code"
                    required
                    pattern="[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}"
                    placeholder="ABCD-EFGH-JKMN"
                  />
                </label>
                <label>
                  Device name
                  <input name="deviceName" required defaultValue="My Mac" />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? 'Connecting…' : 'Pair and connect'}
                </button>
              </form>
              <details className="server-install" open>
                <summary>Install Factoru Server on the remote machine</summary>
                <p className="muted">
                  Experimental source preview for 64-bit Linux. After cloning dev and logging into
                  Codex, install and validate the pinned host runtime in one command:
                </p>
                <pre aria-label="Remote server setup commands">
                  <code>./scripts/remote-bootstrap.sh --provider codex</code>
                </pre>
                <p className="install-note">
                  Use --provider claude when appropriate. Keep Server on loopback and connect
                  through SSH or trusted HTTPS. The complete source runbook is
                  docs/remote-connection.md; packaged installation remains Milestone 7 work.
                </p>
              </details>
            </>
          )}
          {snapshot.profiles.length > 0 && (
            <button type="button" onClick={() => setShowPairing(false)}>
              Cancel
            </button>
          )}
          {(error || snapshot.error) && <p className="error">{error ?? snapshot.error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className={`workspace-shell ${showProjectSetup ? 'project-setup-open' : ''}`}>
      <aside className="sidebar">
        <header className="sidebar-brand">
          <span className="brand-mark small" aria-hidden="true">
            F
          </span>
          <div>
            <strong>Factoru</strong>
            <span className="muted">Personal factory</span>
          </div>
        </header>

        <div className="connection-row">
          <span className={`status-dot ${snapshot.connected ? 'online' : 'offline'}`} />
          <span>{snapshot.connected ? 'Server connected' : 'Working offline'}</span>
        </div>

        <div className="sidebar-section-head">
          <span>Projects</span>
          <button
            className="icon-button"
            aria-label="Add project"
            title="Add project"
            onClick={() => void loadRoots()}
            disabled={!snapshot.connected || busy}
          >
            +
          </button>
        </div>
        <nav className="project-nav" aria-label="Projects">
          {snapshot.projects.length === 0 ? (
            <p className="empty-sidebar">Create a project and add its repositories to begin.</p>
          ) : (
            snapshot.projects.map((project) => (
              <button
                key={project.id}
                className={project.id === snapshot.activeProjectId ? 'active' : ''}
                onClick={() =>
                  void run(() => window.factoru.product.selectProject(project.id)).then(
                    (value) => value && setSnapshot(value),
                  )
                }
              >
                <span className="project-glyph">{project.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {statusLabel(project.setupState)} · {project.repositories.length}{' '}
                    {project.repositories.length === 1 ? 'rig' : 'rigs'}
                  </small>
                </span>
              </button>
            ))
          )}
        </nav>

        <details className="server-settings">
          <summary>Server & devices</summary>
          <label>
            Server
            <select
              value={snapshot.activeServerId ?? ''}
              onChange={(event) =>
                void run(() => window.factoru.product.activate(event.target.value)).then(
                  (value) => value && setSnapshot(value),
                )
              }
            >
              {snapshot.profiles.map((profile) => (
                <option key={profile.serverId} value={profile.serverId}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void run(() => window.factoru.product.reconnect())}>
            Reconnect
          </button>
          <button onClick={() => setShowPairing(true)}>Add server</button>
          <button
            onClick={() =>
              void run(() => window.factoru.product.devices()).then(
                (value) => value && setDevices(value),
              )
            }
          >
            Trusted devices
          </button>
        </details>
      </aside>

      <section className="conversation-pane">
        <header className="pane-header">
          <div>
            <p className="eyebrow">Project Manager</p>
            <h1>{activeProject?.name ?? 'Choose a project'}</h1>
          </div>
          {snapshot.workspace && (
            <span className={`health-pill ${snapshot.workspace.conversation.status}`}>
              {statusLabel(snapshot.workspace.conversation.status)}
            </span>
          )}
        </header>

        {snapshot.cached && (
          <p className="offline-banner">Showing cached history. Sending and editing are paused.</p>
        )}

        {showProjectSetup ? (
          <section className="setup-panel">
            <header>
              <div>
                <p className="eyebrow">New project</p>
                <h2>Create a project</h2>
                <p className="setup-intro">
                  Name the work, then add one or more Git repositories. The first repository is the
                  primary execution rig.
                </p>
              </div>
              <button onClick={() => setShowProjectSetup(false)}>Close</button>
            </header>
            <form className="project-create-form" onSubmit={createProject}>
              <div className="project-basics">
                <label>
                  Project name
                  <input
                    autoFocus
                    required
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="My product"
                  />
                </label>
                <label>
                  Description <span className="optional">Optional</span>
                  <input
                    value={projectDescription}
                    onChange={(event) => setProjectDescription(event.target.value)}
                    placeholder="What are these repositories building together?"
                  />
                </label>
              </div>

              <div className="repository-picker-card">
                <div className="repository-picker-heading">
                  <div>
                    <strong>Repositories</strong>
                    <p>Add a Git URL or choose a repository already on this Mac.</p>
                  </div>
                  <span className="repository-count">{repositoryDrafts.length}</span>
                </div>

                <div className="url-add-row">
                  <input
                    type="url"
                    value={repositoryUrl}
                    onChange={(event) => setRepositoryUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && repositoryUrl.trim()) {
                        event.preventDefault()
                        addRepositoryUrl()
                      }
                    }}
                    placeholder="https://github.com/organization/repository.git"
                    aria-label="Git repository URL"
                  />
                  <select
                    value={rootId}
                    onChange={(event) => void browse(event.target.value, '')}
                    aria-label="Clone destination"
                  >
                    {roots.map((root) => (
                      <option key={root.id} value={root.id}>
                        {root.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addRepositoryUrl}
                    disabled={!repositoryUrl.trim() || !rootId}
                  >
                    Add URL
                  </button>
                </div>

                <div className="picker-divider">
                  <span>or</span>
                </div>

                <button
                  className="native-picker-button"
                  type="button"
                  onClick={chooseRepositoryFolder}
                  disabled={busy}
                >
                  <span className="folder-icon" aria-hidden="true">
                    ⌘
                  </span>
                  <span>
                    <strong>Choose repository folder…</strong>
                    <small>Opens the native folder picker</small>
                  </span>
                </button>

                <button
                  className="server-browser-toggle"
                  type="button"
                  onClick={() => setShowServerBrowser((current) => !current)}
                >
                  {showServerBrowser ? 'Hide server browser' : 'Browse approved server folders'}
                </button>

                {showServerBrowser && (
                  <div className="server-browser">
                    <div className="browser-toolbar">
                      <select
                        value={rootId}
                        onChange={(event) => void browse(event.target.value, '')}
                      >
                        {roots.map((root) => (
                          <option key={root.id} value={root.id}>
                            {root.label}
                          </option>
                        ))}
                      </select>
                      {directory && (
                        <button
                          type="button"
                          onClick={() =>
                            void browse(rootId, directory.split('/').slice(0, -1).join('/'))
                          }
                        >
                          Up
                        </button>
                      )}
                      <code>/{directory}</code>
                    </div>
                    <ul className="repository-list">
                      {entries.map((entry) => (
                        <li key={`${entry.kind}:${entry.relativePath}`}>
                          <button
                            type="button"
                            onClick={() =>
                              entry.kind === 'directory'
                                ? void browse(rootId, entry.relativePath)
                                : void run(() =>
                                    window.factoru.product.preview(rootId, entry.relativePath),
                                  ).then((value) => value && addPreview(value))
                            }
                          >
                            <span>{entry.kind === 'directory' ? 'Folder' : 'Git'}</span>
                            {entry.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview && !preview.safe && (
                  <p className="error repository-error">{preview.blockedReason}</p>
                )}
              </div>

              {repositoryDrafts.length > 0 && (
                <ol className="selected-repositories">
                  {repositoryDrafts.map((draft, index) => (
                    <li key={draft.id}>
                      <span className="repository-order">{index + 1}</span>
                      <span className="repository-source-icon" aria-hidden="true">
                        {draft.kind === 'local' ? '⌘' : '↗'}
                      </span>
                      <span className="repository-summary">
                        <strong>
                          {draft.kind === 'local'
                            ? draft.preview.suggestedName
                            : draft.url
                                .split('/')
                                .at(-1)
                                ?.replace(/\.git$/, '') || draft.url}
                        </strong>
                        <small>
                          {draft.kind === 'local'
                            ? `${draft.preview.relativePath || '/'} · ${draft.preview.defaultBranch}`
                            : draft.url}
                        </small>
                      </span>
                      {index === 0 && <span className="primary-rig-badge">Primary rig</span>}
                      <button
                        type="button"
                        className="remove-repository"
                        aria-label="Remove repository"
                        onClick={() =>
                          setRepositoryDrafts((current) =>
                            current.filter((candidate) => candidate.id !== draft.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              <footer className="project-create-actions">
                <p>
                  {repositoryDrafts.length === 0
                    ? 'Add at least one repository to continue.'
                    : `${repositoryDrafts.length} ${repositoryDrafts.length === 1 ? 'rig' : 'rigs'} will be created.`}
                </p>
                <button
                  className="primary"
                  disabled={!projectName.trim() || repositoryDrafts.length === 0 || busy}
                >
                  {busy ? 'Creating…' : 'Create project'}
                </button>
              </footer>
            </form>
          </section>
        ) : !snapshot.workspace ? (
          <section className="empty-state">
            <h2>No project selected</h2>
            <p>Create a project with one or more repositories, or choose one from the sidebar.</p>
          </section>
        ) : (
          <>
            <div className="message-list" aria-live="polite">
              {snapshot.workspace.conversation.messages.length === 0 ? (
                <section className="conversation-empty">
                  <span className="avatar">PM</span>
                  <h2>What should we work on?</h2>
                  <p>
                    Discuss the repository, clarify a direction, or ask the Project Manager to help
                    shape the next task.
                  </p>
                </section>
              ) : (
                snapshot.workspace.conversation.messages.map((message) => (
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
            <form className="composer" onSubmit={sendMessage}>
              <textarea
                name="message"
                rows={3}
                maxLength={32_000}
                placeholder="Message your Project Manager…"
                disabled={!snapshot.connected || busy}
              />
              <button className="primary" disabled={!snapshot.connected || busy}>
                Send
              </button>
            </form>
          </>
        )}
      </section>

      <aside className="inspector-pane">
        <header className="inspector-tabs">
          <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
            Tasks
          </button>
          <button className={tab === 'workers' ? 'active' : ''} onClick={() => setTab('workers')}>
            Workers
          </button>
        </header>

        {tab === 'tasks' ? (
          <div className="task-board" aria-label="Tasks">
            {snapshot.workspace ? (
              <>
                <section className="board-toolbar">
                  <details>
                    <summary>Capture a task</summary>
                    <form className="task-create-form" onSubmit={createTask}>
                      <input name="title" required maxLength={200} placeholder="A rough thought…" />
                      <textarea
                        name="description"
                        rows={2}
                        maxLength={20_000}
                        placeholder="Optional context or acceptance criteria"
                      />
                      <select name="status" defaultValue="backlog">
                        <option value="backlog">Save to Backlog</option>
                        <option value="queue">Save and request planning</option>
                      </select>
                      <button className="primary" disabled={!snapshot.connected || busy}>
                        Add task
                      </button>
                    </form>
                  </details>
                  <div className="queue-summary" aria-live="polite">
                    <strong>Execution WIP {snapshot.workspace.factory.executionWipLimit}</strong>
                    {snapshot.workspace.queueReconciliation ? (
                      <span
                        className={`health-pill ${snapshot.workspace.queueReconciliation.status}`}
                      >
                        Planning {statusLabel(snapshot.workspace.queueReconciliation.status)} · r
                        {snapshot.workspace.queueReconciliation.coalescedThroughRevision}
                      </span>
                    ) : (
                      <span className="muted">Queue is settled</span>
                    )}
                  </div>
                  {snapshot.workspace.taskMergeProposals.map((proposal) => {
                    const source = snapshot.workspace!.tasks.find(
                      (task) => task.id === proposal.sourceTaskId,
                    )
                    const target = snapshot.workspace!.tasks.find(
                      (task) => task.id === proposal.targetTaskId,
                    )
                    return (
                      <article className="merge-proposal" key={proposal.id}>
                        <strong>Merge confirmation</strong>
                        <p>
                          Merge “{source?.title ?? proposal.sourceTaskId}” into “
                          {target?.title ?? proposal.targetTaskId}”? {proposal.reason}
                        </p>
                        <div>
                          <button
                            className="primary"
                            disabled={!snapshot.connected || busy}
                            onClick={() =>
                              void run(() =>
                                window.factoru.product.decideTaskMerge({
                                  projectId: proposal.projectId,
                                  proposalId: proposal.id,
                                  decision: 'accept',
                                }),
                              )
                            }
                          >
                            Confirm merge
                          </button>
                          <button
                            disabled={!snapshot.connected || busy}
                            onClick={() =>
                              void run(() =>
                                window.factoru.product.decideTaskMerge({
                                  projectId: proposal.projectId,
                                  proposalId: proposal.id,
                                  decision: 'reject',
                                }),
                              )
                            }
                          >
                            Keep separate
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </section>
                <div className="task-grid">
                  {taskColumns.map(([id, label]) => {
                    const tasks = snapshot.workspace!.tasks.filter((task) => task.status === id)
                    return (
                      <section key={id} className="task-column">
                        <header>
                          <span className={`column-dot ${id}`} />
                          <h2>{label}</h2>
                          <span>{tasks.length}</span>
                        </header>
                        <div className="task-list">
                          {tasks.length === 0 ? (
                            <p>No tasks</p>
                          ) : (
                            tasks.map((task) => {
                              const taskRun = snapshot.workspace!.taskRuns.find(
                                (candidate) => candidate.taskId === task.id,
                              )
                              return (
                                <article className="task-card" key={`${task.id}:${task.version}`}>
                                  <header>
                                    <strong>{task.title}</strong>
                                    {task.queuePhase && (
                                      <span className="phase-badge">
                                        {statusLabel(task.queuePhase)}
                                      </span>
                                    )}
                                  </header>
                                  {task.description && <p>{task.description}</p>}
                                  {task.status === 'needs_you' && (
                                    <div className="needs-action">
                                      <strong>{statusLabel(task.needsYouAction!)}</strong>
                                      <span>{task.needsYouMessage}</span>
                                    </div>
                                  )}
                                  {taskRun && (
                                    <section
                                      className="run-summary"
                                      aria-label="Software delivery run"
                                    >
                                      <header>
                                        <strong>{statusLabel(taskRun.stage)}</strong>
                                        <span className={`health-pill ${taskRun.status}`}>
                                          {statusLabel(taskRun.status)}
                                        </span>
                                      </header>
                                      <div className="run-meter">
                                        {taskRun.steps.map((step) => (
                                          <span
                                            className={step.status}
                                            key={step.id}
                                            title={step.title}
                                          >
                                            {statusLabel(step.title)}
                                          </span>
                                        ))}
                                      </div>
                                      <p>
                                        {taskRun.usage.inputTokens + taskRun.usage.outputTokens}{' '}
                                        tokens ·{' '}
                                        {taskRun.usage.pricing === 'priced'
                                          ? `$${taskRun.usage.estimatedCostUsd.toFixed(4)} estimated`
                                          : taskRun.usage.pricing === 'unpriced'
                                            ? 'cost unpriced by the configured provider'
                                            : 'cost pending'}
                                      </p>
                                      {taskRun.error && (
                                        <p className="run-error">
                                          {taskRun.error.code}: {taskRun.error.message}
                                        </p>
                                      )}
                                      {(taskRun.logs.length > 0 || taskRun.reviewPackage) && (
                                        <details className="run-evidence">
                                          <summary>Logs and evidence</summary>
                                          {taskRun.logs.map((entry, index) => (
                                            <pre key={index}>{entry}</pre>
                                          ))}
                                          {taskRun.reviewPackage && (
                                            <>
                                              <strong>Commits</strong>
                                              <pre>{taskRun.reviewPackage.commits.join('\n')}</pre>
                                              <strong>Checks</strong>
                                              <pre>{taskRun.reviewPackage.checks.output}</pre>
                                              <strong>Independent review</strong>
                                              <pre>{taskRun.reviewPackage.internalReview}</pre>
                                              <strong>Diff</strong>
                                              <pre>{taskRun.reviewPackage.diff}</pre>
                                              {taskRun.reviewPackage.unresolvedRisks.length > 0 && (
                                                <p className="run-error">
                                                  Risks:{' '}
                                                  {taskRun.reviewPackage.unresolvedRisks.join('; ')}
                                                </p>
                                              )}
                                            </>
                                          )}
                                        </details>
                                      )}
                                      <div className="run-actions">
                                        {['pending', 'running', 'cancelling'].includes(
                                          taskRun.status,
                                        ) && (
                                          <button
                                            disabled={
                                              !snapshot.connected ||
                                              busy ||
                                              taskRun.status === 'cancelling'
                                            }
                                            onClick={() =>
                                              void run(() =>
                                                window.factoru.product.cancelRun(
                                                  task.projectId,
                                                  taskRun.id,
                                                ),
                                              )
                                            }
                                          >
                                            Cancel run
                                          </button>
                                        )}
                                        {taskRun.status === 'completed' && (
                                          <>
                                            <button
                                              className="primary"
                                              disabled={!snapshot.connected || busy}
                                              onClick={() =>
                                                window.confirm('Approve this implementation?') &&
                                                void run(() =>
                                                  window.factoru.product.approveRun(
                                                    task.projectId,
                                                    taskRun.id,
                                                    'Accepted after reviewing the delivery evidence.',
                                                  ),
                                                )
                                              }
                                            >
                                              Approve
                                            </button>
                                            <button
                                              disabled={!snapshot.connected || busy}
                                              onClick={() => {
                                                const feedback = window
                                                  .prompt('What should the implementation change?')
                                                  ?.trim()
                                                if (feedback)
                                                  void run(() =>
                                                    window.factoru.product.requestRunChanges(
                                                      task.projectId,
                                                      taskRun.id,
                                                      feedback,
                                                    ),
                                                  )
                                              }}
                                            >
                                              Request changes
                                            </button>
                                          </>
                                        )}
                                        {taskRun.status === 'failed' && (
                                          <button
                                            disabled={!snapshot.connected || busy}
                                            onClick={() =>
                                              void run(() =>
                                                window.factoru.product.retryRun(
                                                  task.projectId,
                                                  taskRun.id,
                                                ),
                                              )
                                            }
                                          >
                                            Retry
                                          </button>
                                        )}
                                        {['completed', 'failed', 'cancelled'].includes(
                                          taskRun.status,
                                        ) && (
                                          <button
                                            disabled={!snapshot.connected || busy}
                                            onClick={() =>
                                              void run(() =>
                                                window.factoru.product.archiveRun(
                                                  task.projectId,
                                                  taskRun.id,
                                                ),
                                              )
                                            }
                                          >
                                            Archive run
                                          </button>
                                        )}
                                      </div>
                                    </section>
                                  )}
                                  <footer>
                                    <span>Priority {task.priority}</span>
                                    <span>
                                      {task.workerTypeKind
                                        ? statusLabel(task.workerTypeKind)
                                        : 'Unassigned'}
                                    </span>
                                  </footer>
                                  {task.status === 'backlog' && (
                                    <button
                                      className="queue-button"
                                      disabled={!snapshot.connected || busy}
                                      onClick={() => void queueTask(task)}
                                    >
                                      Move to Queue
                                    </button>
                                  )}
                                  <details className="task-details">
                                    <summary>Edit and move</summary>
                                    <form onSubmit={(event) => updateTask(event, task)}>
                                      <input
                                        name="title"
                                        required
                                        defaultValue={task.title}
                                        maxLength={200}
                                      />
                                      <textarea
                                        name="description"
                                        rows={3}
                                        defaultValue={task.description}
                                        maxLength={20_000}
                                      />
                                      <label>
                                        Priority
                                        <input
                                          name="priority"
                                          type="number"
                                          min={0}
                                          max={100}
                                          defaultValue={task.priority}
                                        />
                                      </label>
                                      <button disabled={!snapshot.connected || busy}>
                                        Save edits
                                      </button>
                                    </form>
                                    <form onSubmit={(event) => moveTask(event, task)}>
                                      <select name="status" defaultValue={task.status}>
                                        {taskColumns.map(([value, text]) => (
                                          <option value={value} key={value}>
                                            {text}
                                          </option>
                                        ))}
                                      </select>
                                      <select name="needsYouAction" defaultValue="clarify">
                                        <option value="clarify">Clarify</option>
                                        <option value="approve">Approve</option>
                                        <option value="review">Review</option>
                                        <option value="resolve_conflict">Resolve conflict</option>
                                        <option value="recover_failure">Recover failure</option>
                                      </select>
                                      <input
                                        name="needsYouMessage"
                                        placeholder="Required when moving to Needs you"
                                      />
                                      <button disabled={!snapshot.connected || busy}>Move</button>
                                    </form>
                                    <form onSubmit={(event) => resolveTask(event, task)}>
                                      <select name="resolution" defaultValue="cancelled">
                                        <option value="accepted">Accepted</option>
                                        <option value="rejected">Rejected</option>
                                        <option value="cancelled">Cancelled</option>
                                      </select>
                                      <input
                                        name="summary"
                                        required
                                        placeholder="Why is this terminal?"
                                      />
                                      <button
                                        className="danger"
                                        disabled={!snapshot.connected || busy}
                                      >
                                        Resolve task
                                      </button>
                                    </form>
                                  </details>
                                </article>
                              )
                            })
                          )}
                        </div>
                      </section>
                    )
                  })}
                </div>
              </>
            ) : (
              <p className="board-note">Choose a project to see its task board.</p>
            )}
          </div>
        ) : snapshot.workspace ? (
          <div className="workers-panel">
            <section className="factory-card">
              <div>
                <p className="eyebrow">Factory capacity</p>
                <strong>1 implementation at a time</strong>
              </div>
              <span className="health-pill ready">Serial MVP</span>
            </section>

            {snapshot.workspace.workerTypes.map((worker) => (
              <section className="worker-card" key={worker.kind}>
                <header>
                  <span className="avatar">{worker.kind === 'project_manager' ? 'PM' : 'SE'}</span>
                  <div>
                    <h2>{worker.displayName}</h2>
                    <p>{worker.defaultFormula}</p>
                  </div>
                  <span className="health-pill ready">capacity {worker.capacity}</span>
                </header>
                <details open>
                  <summary>Model slots</summary>
                  {worker.modelBindings.map((binding) => (
                    <form
                      className="model-row"
                      key={`${binding.slot}:${binding.version}`}
                      onSubmit={(event) => updateModel(event, worker, binding.slot)}
                    >
                      <strong>{statusLabel(binding.slot)}</strong>
                      <input
                        name="provider"
                        aria-label={`${binding.slot} provider`}
                        placeholder="Provider adapter"
                        defaultValue={binding.provider ?? ''}
                        disabled={!snapshot.connected}
                      />
                      <input
                        name="model"
                        aria-label={`${binding.slot} model`}
                        placeholder="Model ID"
                        defaultValue={binding.model ?? ''}
                        disabled={!snapshot.connected}
                      />
                      <button disabled={!snapshot.connected || busy}>Save</button>
                    </form>
                  ))}
                </details>
                <details>
                  <summary>Policy & tools</summary>
                  <p>{worker.memoryPolicy.replaceAll('_', ' ')}</p>
                  <ul>
                    {worker.allowedTools.map((tool) => (
                      <li key={tool}>{tool}</li>
                    ))}
                  </ul>
                </details>
              </section>
            ))}

            <section className="worker-card planner-card">
              <header>
                <div>
                  <h2>Planner isolation probe</h2>
                  <p>Runs separately while chat stays responsive.</p>
                </div>
                {snapshot.workspace.plannerProbe && (
                  <span className={`health-pill ${snapshot.workspace.plannerProbe.status}`}>
                    {statusLabel(snapshot.workspace.plannerProbe.status)}
                  </span>
                )}
              </header>
              {snapshot.workspace.plannerProbe &&
              ['pending', 'running', 'cancelling'].includes(
                snapshot.workspace.plannerProbe.status,
              ) ? (
                <button
                  disabled={!snapshot.connected || busy}
                  onClick={() =>
                    void run(() =>
                      window.factoru.product.cancelPlanner(
                        snapshot.workspace!.projectId,
                        snapshot.workspace!.plannerProbe!.id,
                      ),
                    )
                  }
                >
                  Cancel planner probe
                </button>
              ) : (
                <button
                  disabled={!snapshot.connected || busy}
                  onClick={() =>
                    void run(() =>
                      window.factoru.product.startPlanner(snapshot.workspace!.projectId),
                    )
                  }
                >
                  Run planner probe
                </button>
              )}
            </section>

            <section className="worker-card memory-card">
              <header>
                <div>
                  <h2>Durable memory</h2>
                  <p>Every entry keeps explicit provenance and version history.</p>
                </div>
              </header>
              <ul>
                {snapshot.workspace.memory.map((entry) => (
                  <li key={entry.id}>
                    <span>{entry.content}</span>
                    <small>
                      {entry.scope} · v{entry.version} · {entry.provenance.ref}
                    </small>
                  </li>
                ))}
              </ul>
              <form className="form-stack compact" onSubmit={addMemory}>
                <label>
                  Scope
                  <select name="scope" defaultValue="project">
                    <option value="project">Project</option>
                    <option value="worker_type">Worker Type</option>
                  </select>
                </label>
                <label>
                  Worker Type
                  <select name="workerTypeKind" defaultValue="project_manager">
                    <option value="project_manager">Project Manager</option>
                    <option value="software_engineer">Software Engineer</option>
                  </select>
                </label>
                <textarea name="content" required rows={3} placeholder="A durable project fact…" />
                <button disabled={!snapshot.connected || busy}>Add memory</button>
              </form>
            </section>
          </div>
        ) : (
          <div className="empty-state small">Choose a project to inspect its workers.</div>
        )}
      </aside>

      {devices.length > 0 && (
        <section className="device-drawer">
          <header>
            <h2>Trusted devices</h2>
            <button onClick={() => setDevices([])}>Close</button>
          </header>
          {devices.map((device) => (
            <div key={device.id}>
              <span>{device.name}</span>
              {!device.revokedAt && (
                <button
                  onClick={() =>
                    window.confirm(`Revoke ${device.name}?`) &&
                    void run(() => window.factoru.product.revoke(device.id)).then(() =>
                      window.factoru.product.devices().then(setDevices),
                    )
                  }
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {(error || snapshot.error) && (
        <div className="toast error" role="alert">
          <span>{error ?? snapshot.error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
    </main>
  )
}
