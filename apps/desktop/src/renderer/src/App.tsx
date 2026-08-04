import { useCallback, useEffect, useState } from 'react'
import type { ConnectionSnapshot } from '../../shared/connection'
import { isCached } from '../../shared/connection'

const STATE_LABELS: Record<ConnectionSnapshot['state'], string> = {
  unconfigured: 'Not connected',
  pairing: 'Pairing',
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  blocked: 'Blocked',
}

function formatUptime(uptimeMs: number): string {
  const totalSeconds = Math.floor(uptimeMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatTime(iso: string | null): string {
  if (iso === null) return 'never'
  return new Date(iso).toLocaleTimeString()
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd className={mono === true ? 'mono' : undefined}>{value}</dd>
    </div>
  )
}

export function App() {
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let active = true
    void window.factoru.connection.get().then((current) => {
      if (active) setSnapshot(current)
    })
    const unsubscribe = window.factoru.connection.subscribe(setSnapshot)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const refresh = useCallback(() => {
    setRefreshing(true)
    void window.factoru.connection
      .refresh()
      .then(setSnapshot)
      .finally(() => setRefreshing(false))
  }, [])

  if (snapshot === null) {
    return (
      <main className="shell">
        <p className="muted">Starting Factoru Desktop…</p>
      </main>
    )
  }

  const { health } = snapshot
  const cached = isCached(snapshot)

  return (
    <main className="shell">
      <header className="header">
        <h1>Factoru</h1>
        <p className="server-url mono">{snapshot.serverUrl}</p>
      </header>

      <section className="card" aria-labelledby="connection-heading">
        <div className="card-head">
          <h2 id="connection-heading">Factoru Server</h2>
          <span
            className={`badge badge-${snapshot.state}`}
            role="status"
            aria-live="polite"
            data-testid="connection-state"
          >
            {STATE_LABELS[snapshot.state]}
          </span>
        </div>

        {health === null ? (
          <p className="muted">
            No Factoru Server has answered yet. Start one with <code>pnpm dev:server</code>, then
            check again.
          </p>
        ) : (
          <>
            {cached && (
              <p className="notice" role="note">
                Showing the last known server state from {formatTime(snapshot.lastConnectedAt)}.
              </p>
            )}
            <dl className="fields">
              <Field label="Server id" value={health.serverId} mono />
              <Field label="Server version" value={health.serverVersion} mono />
              <Field
                label="Protocol"
                value={
                  snapshot.negotiatedProtocolVersion === null
                    ? `not negotiated (server speaks ${health.minProtocolVersion}–${health.protocolVersion})`
                    : `v${snapshot.negotiatedProtocolVersion} (server speaks ${health.minProtocolVersion}–${health.protocolVersion})`
                }
              />
              <Field label="Health" value={health.status} />
              <Field label="Uptime" value={formatUptime(health.uptimeMs)} />
              <Field label="Capabilities" value={health.capabilities.join(', ') || 'none'} />
              <Field label="Last checked" value={formatTime(snapshot.lastCheckedAt)} />
            </dl>
          </>
        )}

        {snapshot.error !== null && (
          <p className="error" role="alert">
            <strong>{snapshot.blockedReason ?? snapshot.error.code}</strong>
            <span>{snapshot.error.message}</span>
          </p>
        )}

        <div className="actions">
          <button type="button" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </section>

      <footer className="footer muted">
        Milestone 0 walking skeleton: health and handshake only. Projects, conversation, and tasks
        arrive in later milestones.
      </footer>
    </main>
  )
}
