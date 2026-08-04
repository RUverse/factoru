import type { BlockedReason, ConnectionState } from '@factoru/domain'
import type { FactoruErrorCode, HealthResponse } from '@factoru/protocol'

/**
 * The connection view shared by Electron main, the preload bridge, and the
 * renderer. It is the only shape that crosses the trust boundary, so it must
 * stay serializable and free of credentials or transport handles.
 */
export interface ConnectionSnapshot {
  readonly state: ConnectionState
  readonly serverUrl: string
  /** Present once a handshake has succeeded; kept while offline, marked cached. */
  readonly health: HealthResponse | null
  readonly negotiatedProtocolVersion: number | null
  readonly blockedReason: BlockedReason | null
  readonly error: { readonly code: FactoruErrorCode; readonly message: string } | null
  /** ISO timestamp of the last completed attempt, successful or not. */
  readonly lastCheckedAt: string | null
  /** ISO timestamp of the last successful handshake. */
  readonly lastConnectedAt: string | null
}

export const IPC_CONNECTION_GET = 'factoru:connection:get' as const
export const IPC_CONNECTION_REFRESH = 'factoru:connection:refresh' as const
export const IPC_CONNECTION_CHANGED = 'factoru:connection:changed' as const

/**
 * The entire privileged surface the preload bridge exposes to the renderer.
 *
 * It is deliberately a small allowlist of named operations: no raw IPC, no
 * filesystem, no shell, and no way to construct an arbitrary request.
 */
export interface FactoruBridge {
  readonly connection: {
    get(): Promise<ConnectionSnapshot>
    refresh(): Promise<ConnectionSnapshot>
    subscribe(listener: (snapshot: ConnectionSnapshot) => void): () => void
  }
}

/** True while displayed server data is a cached copy rather than live state. */
export function isCached(snapshot: ConnectionSnapshot): boolean {
  return snapshot.health !== null && snapshot.state !== 'connected'
}
