import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ProjectPreview, TrustedDevice, WorkerType } from '@factoru/protocol'
import type { ProductSnapshot } from '../../shared/product'

type Root = { id: string; label: string }
type Entry = { name: string; relativePath: string; kind: 'directory' | 'repository' }

const taskColumns = [
  ['needs_you', 'Needs you'],
  ['in_progress', 'In progress'],
  ['queue', 'Queue'],
  ['backlog', 'Backlog'],
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
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:8787')
  const [roots, setRoots] = useState<Root[]>([])
  const [rootId, setRootId] = useState('')
  const [directory, setDirectory] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [preview, setPreview] = useState<ProjectPreview | null>(null)
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

  const loadRoots = async () => {
    const loaded = await run(() => window.factoru.product.roots())
    if (!loaded) return
    setRoots(loaded)
    const first = loaded[0]?.id ?? ''
    setRootId(first)
    setDirectory('')
    setEntries(first ? ((await run(() => window.factoru.product.browse(first, ''))) ?? []) : [])
    setShowProjectSetup(true)
  }

  const browse = async (nextRoot: string, nextDirectory: string) => {
    setRootId(nextRoot)
    setDirectory(nextDirectory)
    setPreview(null)
    setEntries((await run(() => window.factoru.product.browse(nextRoot, nextDirectory))) ?? [])
  }

  const createProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!preview) return
    const data = new FormData(event.currentTarget)
    void run(() =>
      window.factoru.product.create({
        rootId: preview.rootId,
        relativePath: preview.relativePath,
        name: String(data.get('name')),
        description: String(data.get('description') || '') || undefined,
        defaultBranch: String(data.get('branch')),
        fingerprint: preview.fingerprint,
      }),
    ).then((created) => {
      if (created) {
        setShowProjectSetup(false)
        setPreview(null)
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
            <button type="button" onClick={() => setServerUrl('http://127.0.0.1:8787')}>
              This device
            </button>
            <button type="button" onClick={() => setServerUrl('https://')}>
              Remote server
            </button>
          </div>
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
            {snapshot.profiles.length > 0 && (
              <button type="button" onClick={() => setShowPairing(false)}>
                Cancel
              </button>
            )}
          </form>
          {(error || snapshot.error) && <p className="error">{error ?? snapshot.error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="workspace-shell">
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
            <p className="empty-sidebar">Add a server-local repository to begin.</p>
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
                  <small>{statusLabel(project.setupState)}</small>
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
                <h2>Choose an approved repository</h2>
              </div>
              <button onClick={() => setShowProjectSetup(false)}>Close</button>
            </header>
            <div className="browser-toolbar">
              <select value={rootId} onChange={(event) => void browse(event.target.value, '')}>
                {roots.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.label}
                  </option>
                ))}
              </select>
              {directory && (
                <button
                  onClick={() => void browse(rootId, directory.split('/').slice(0, -1).join('/'))}
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
                    onClick={() =>
                      entry.kind === 'directory'
                        ? void browse(rootId, entry.relativePath)
                        : void run(() =>
                            window.factoru.product.preview(rootId, entry.relativePath),
                          ).then((value) => value && setPreview(value))
                    }
                  >
                    <span>{entry.kind === 'directory' ? 'Folder' : 'Git'}</span>
                    {entry.name}
                  </button>
                </li>
              ))}
            </ul>
            {preview && (
              <form className="form-grid" onSubmit={createProject}>
                {!preview.safe && <p className="error">{preview.blockedReason}</p>}
                <label>
                  Project name
                  <input name="name" required defaultValue={preview.suggestedName} />
                </label>
                <label>
                  Description
                  <input name="description" />
                </label>
                <label>
                  Default branch
                  <select name="branch" defaultValue={preview.defaultBranch}>
                    {preview.branches.map((branch) => (
                      <option key={branch}>{branch}</option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={!preview.safe || busy}>
                  Create project
                </button>
              </form>
            )}
          </section>
        ) : !snapshot.workspace ? (
          <section className="empty-state">
            <h2>No project selected</h2>
            <p>Add an existing repository or choose a project from the sidebar.</p>
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
            {taskColumns.map(([id, label]) => (
              <section key={id} className="task-column">
                <header>
                  <span className={`column-dot ${id}`} />
                  <h2>{label}</h2>
                  <span>0</span>
                </header>
                <p>No tasks</p>
              </section>
            ))}
            <p className="board-note">
              Persistent task capture and Queue reconciliation arrive in Milestone 4.
            </p>
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
