/**
 * The desktop connection state machine described in docs/ARCHITECTURE.md.
 *
 * It is defined here, framework-independent, so that the Electron connection
 * runtime, future web/CLI clients, and tests all agree on which transitions are
 * legal. Transport health is deliberately distinct from data synchronization:
 * `connected` means the handshake succeeded, not that every subscription is
 * caught up.
 */
export type ConnectionState =
  'unconfigured' | 'pairing' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'blocked'

export type BlockedReason =
  'incompatible_protocol' | 'unauthorized' | 'server_error' | 'invalid_response'

export type ConnectionEvent =
  | { type: 'server_added' }
  | { type: 'credential_issued' }
  | { type: 'connect_requested' }
  | { type: 'handshake_succeeded' }
  | { type: 'handshake_blocked'; reason: BlockedReason }
  | { type: 'network_unavailable' }
  | { type: 'network_returned' }
  | { type: 'disconnected' }
  | { type: 'configuration_changed' }
  | { type: 'server_removed' }

const TRANSITIONS: Record<
  ConnectionState,
  Partial<Record<ConnectionEvent['type'], ConnectionState>>
> = {
  unconfigured: { server_added: 'pairing', connect_requested: 'connecting' },
  pairing: { credential_issued: 'connecting', server_removed: 'unconfigured' },
  connecting: {
    handshake_succeeded: 'connected',
    handshake_blocked: 'blocked',
    network_unavailable: 'offline',
    server_removed: 'unconfigured',
  },
  connected: {
    disconnected: 'reconnecting',
    network_unavailable: 'offline',
    handshake_blocked: 'blocked',
    server_removed: 'unconfigured',
  },
  reconnecting: {
    handshake_succeeded: 'connected',
    handshake_blocked: 'blocked',
    network_unavailable: 'offline',
    server_removed: 'unconfigured',
  },
  offline: {
    network_returned: 'reconnecting',
    connect_requested: 'reconnecting',
    server_removed: 'unconfigured',
  },
  blocked: {
    configuration_changed: 'connecting',
    connect_requested: 'connecting',
    server_removed: 'unconfigured',
  },
}

/**
 * Returns the next state, or `null` when the event is not legal for the current
 * state. Callers must treat `null` as "ignore", never as an implicit reset.
 */
export function nextConnectionState(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState | null {
  return TRANSITIONS[state][event.type] ?? null
}

/** Cached product data may be displayed in these states, but only as cached. */
export function isLiveState(state: ConnectionState): boolean {
  return state === 'connected'
}
