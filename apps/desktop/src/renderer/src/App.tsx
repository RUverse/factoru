import { useEffect, useState, type FormEvent } from 'react'
import type { ProjectPreview, TrustedDevice } from '@factoru/protocol'
import type { ProductSnapshot } from '../../shared/product'

type Root = { id: string; label: string }
type Entry = { name: string; relativePath: string; kind: 'directory' | 'repository' }

export function App() {
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [roots, setRoots] = useState<Root[]>([])
  const [rootId, setRootId] = useState('')
  const [directory, setDirectory] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [preview, setPreview] = useState<ProjectPreview | null>(null)
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:8787')
  const [showPairing, setShowPairing] = useState(false)

  useEffect(() => {
    let active = true
    void window.factoru.product.get().then((value) => {
      if (active) setSnapshot(value)
    })
    const unsubscribe = window.factoru.product.subscribe(setSnapshot)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

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
    if (first) setEntries((await run(() => window.factoru.product.browse(first, ''))) ?? [])
  }

  const browse = async (nextRoot: string, nextDirectory: string) => {
    setRootId(nextRoot)
    setDirectory(nextDirectory)
    setPreview(null)
    setEntries((await run(() => window.factoru.product.browse(nextRoot, nextDirectory))) ?? [])
  }

  const previewRepository = async (entry: Entry) => {
    const value = await run(() => window.factoru.product.preview(rootId, entry.relativePath))
    if (value) setPreview(value)
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
        setPreview(null)
        setEntries([])
      }
    })
  }

  if (!snapshot)
    return (
      <main className="shell">
        <p className="muted">Starting Factoru Desktop…</p>
      </main>
    )

  return (
    <main className="shell product-shell">
      <header className="header">
        <div>
          <h1>Factoru</h1>
          <p className="muted">Your development team, on your infrastructure.</p>
        </div>
        {snapshot.activeServerId && (
          <span
            className={`badge badge-${snapshot.connected ? 'connected' : 'offline'}`}
            role="status"
          >
            {snapshot.connected ? 'Connected' : 'Offline'}
          </span>
        )}
      </header>

      {snapshot.profiles.length === 0 || showPairing ? (
        <section className="card" aria-labelledby="connect-heading">
          <h2 id="connect-heading">Connect to Factoru Server</h2>
          <div className="toolbar" role="group" aria-label="Connection type">
            <button type="button" onClick={() => setServerUrl('https://')}>
              Connect to a remote server
            </button>
            <button type="button" onClick={() => setServerUrl('http://127.0.0.1:8787')}>
              Run on this device
            </button>
          </div>
          <p className="muted">
            Run <code>factoru-server pair</code> on the server, then enter its one-time code. Remote
            addresses must use HTTPS.
          </p>
          <form className="form-grid" onSubmit={pair}>
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
              Pairing code
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
            <button disabled={busy}>{busy ? 'Connecting…' : 'Pair and connect'}</button>
            {snapshot.profiles.length > 0 && (
              <button type="button" onClick={() => setShowPairing(false)} disabled={busy}>
                Cancel
              </button>
            )}
          </form>
        </section>
      ) : (
        <>
          <section className="toolbar card" aria-label="Server profile">
            <label>
              Server
              <select
                value={snapshot.activeServerId ?? ''}
                onChange={(event) =>
                  void run(() => window.factoru.product.activate(event.target.value)).then(
                    (value) => {
                      if (value) setSnapshot(value)
                    },
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
            <button
              onClick={() =>
                void run(() => window.factoru.product.reconnect()).then((value) => {
                  if (value) setSnapshot(value)
                })
              }
              disabled={busy}
            >
              Reconnect
            </button>
            <button type="button" onClick={() => setShowPairing(true)} disabled={busy}>
              Add server
            </button>
            <button
              type="button"
              disabled={busy || !snapshot.activeServerId}
              onClick={() => {
                if (
                  snapshot.activeServerId &&
                  window.confirm('Remove this server profile from this Mac? Server data is kept.')
                ) {
                  void run(() => window.factoru.product.remove(snapshot.activeServerId!)).then(
                    (value) => {
                      if (value) {
                        setSnapshot(value)
                        setRoots([])
                        setPreview(null)
                        setDevices([])
                      }
                    },
                  )
                }
              }}
            >
              Remove profile
            </button>
            <button onClick={() => void loadRoots()} disabled={!snapshot.connected || busy}>
              Add project
            </button>
            <button
              onClick={() =>
                void run(() => window.factoru.product.devices()).then(
                  (value) => value && setDevices(value),
                )
              }
              disabled={!snapshot.connected || busy}
            >
              Trusted devices
            </button>
          </section>

          {snapshot.cached && (
            <p className="notice" role="note">
              Showing the last synchronized project list. Changes are disabled until the server
              reconnects.
              {snapshot.profiles.find((profile) => profile.serverId === snapshot.activeServerId)
                ?.lastConnectedAt && (
                <>
                  {' '}
                  Last synchronized{' '}
                  {new Date(
                    snapshot.profiles.find(
                      (profile) => profile.serverId === snapshot.activeServerId,
                    )!.lastConnectedAt!,
                  ).toLocaleString()}
                  .
                </>
              )}
            </p>
          )}

          {roots.length > 0 && (
            <section className="card" aria-labelledby="repository-heading">
              <h2 id="repository-heading">Choose an approved repository</h2>
              <div className="toolbar">
                <select
                  aria-label="Repository root"
                  value={rootId}
                  disabled={!snapshot.connected || busy}
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
                    disabled={!snapshot.connected || busy}
                    onClick={() => void browse(rootId, directory.split('/').slice(0, -1).join('/'))}
                  >
                    Up
                  </button>
                )}
                <span className="mono muted">/{directory}</span>
              </div>
              <ul className="repository-list">
                {entries.map((entry) => (
                  <li key={`${entry.kind}:${entry.relativePath}`}>
                    <button
                      disabled={!snapshot.connected || busy}
                      onClick={() =>
                        entry.kind === 'directory'
                          ? void browse(rootId, entry.relativePath)
                          : void previewRepository(entry)
                      }
                    >
                      {entry.kind === 'directory' ? 'Folder' : 'Repository'} · {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {preview && (
            <section className="card" aria-labelledby="preview-heading">
              <h2 id="preview-heading">Confirm project setup</h2>
              {!preview.safe && (
                <p className="error" role="alert">
                  {preview.blockedReason}
                </p>
              )}
              <form className="form-grid" onSubmit={createProject}>
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
                  <select
                    name="branch"
                    disabled={!snapshot.connected || busy}
                    value={preview.defaultBranch}
                    onChange={(event) =>
                      void run(() =>
                        window.factoru.product.preview(
                          preview.rootId,
                          preview.relativePath,
                          event.target.value,
                        ),
                      ).then((value) => {
                        if (value) setPreview(value)
                      })
                    }
                  >
                    {preview.branches.map((branch) => (
                      <option key={branch}>{branch}</option>
                    ))}
                  </select>
                </label>
                <div>
                  <strong>Gas City will make these repository changes:</strong>
                  <ul>
                    {preview.repositoryMutations.map((mutation) => (
                      <li key={mutation}>{mutation}</li>
                    ))}
                  </ul>
                </div>
                {preview.status.length > 0 && (
                  <div>
                    <strong>Current working-tree changes:</strong>
                    <ul>
                      {preview.status.map((item) => (
                        <li key={item.path}>
                          {item.staged ? 'Staged' : item.untracked ? 'Untracked' : 'Unstaged'} ·{' '}
                          {item.path}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button disabled={!snapshot.connected || !preview.safe || busy}>
                  {busy ? 'Creating…' : 'Create project'}
                </button>
              </form>
            </section>
          )}

          {devices.length > 0 && (
            <section className="card">
              <h2>Trusted devices</h2>
              <ul>
                {devices.map((device) => (
                  <li key={device.id} className="device-row">
                    <span>
                      {device.name}
                      {device.revokedAt ? ' · Revoked' : ''}
                    </span>
                    {!device.revokedAt && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Revoke ${device.name}?`))
                            void run(() => window.factoru.product.revoke(device.id)).then(() =>
                              window.factoru.product.devices().then(setDevices),
                            )
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-labelledby="projects-heading">
            <h2 id="projects-heading">Projects</h2>
            {snapshot.projects.length === 0 ? (
              <p className="muted">
                No projects yet. Add an existing repository from the server’s approved roots.
              </p>
            ) : (
              <ul className="project-list">
                {snapshot.projects.map((project) => (
                  <li key={project.id}>
                    <div>
                      <strong>{project.name}</strong>
                      <span className="mono muted">
                        {project.repository.label}/{project.repository.relativePath}
                      </span>
                    </div>
                    <span className={`badge badge-${project.setupState}`}>
                      {project.setupState.replaceAll('_', ' ')}
                    </span>
                    <p>
                      Default branch: {project.defaultBranch} · Rig: {project.rig.rigName}
                    </p>
                    {project.setupError && <p className="error">{project.setupError.message}</p>}
                    {project.setupState === 'needs_attention' && (
                      <button
                        disabled={!snapshot.connected || busy}
                        onClick={() => void run(() => window.factoru.product.retry(project.id))}
                      >
                        Retry setup
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {(error || snapshot.error) && (
        <p className="error" role="alert">
          {error ?? snapshot.error}
        </p>
      )}
    </main>
  )
}
