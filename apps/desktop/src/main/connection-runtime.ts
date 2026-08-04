import { nextConnectionState, type BlockedReason, type ConnectionEvent } from '@factoru/domain'
import { FactoruProtocolError, type FactoruClient, type FactoruErrorCode } from '@factoru/protocol'
import type { ConnectionSnapshot } from '../shared/connection'

/**
 * One owner for connection attempts, retries, and the connection snapshot.
 *
 * React components and IPC handlers never create requests or retry loops of
 * their own; they read this snapshot. The runtime deliberately knows nothing
 * about Electron so it can be unit tested and later reused by another client.
 */
export interface ConnectionRuntimeOptions {
  client: FactoruClient
  /** Delay between checks while connected. */
  connectedIntervalMs?: number
  /** Delay between attempts while offline or reconnecting. */
  retryIntervalMs?: number
  now?: () => Date
  setTimer?: (handler: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export type ConnectionListener = (snapshot: ConnectionSnapshot) => void

const DEFAULT_CONNECTED_INTERVAL_MS = 15_000
const DEFAULT_RETRY_INTERVAL_MS = 3_000

/** Transport-level failures are retried; the rest need a decision or a fix. */
function classify(code: FactoruErrorCode): {
  event: ConnectionEvent
  blockedReason: BlockedReason | null
} {
  switch (code) {
    case 'transport_error':
    case 'timeout':
    case 'unavailable':
      return { event: { type: 'network_unavailable' }, blockedReason: null }
    case 'unauthorized':
      return {
        event: { type: 'handshake_blocked', reason: 'unauthorized' },
        blockedReason: 'unauthorized',
      }
    case 'invalid_response':
      return {
        event: { type: 'handshake_blocked', reason: 'invalid_response' },
        blockedReason: 'invalid_response',
      }
    default:
      return {
        event: { type: 'handshake_blocked', reason: 'server_error' },
        blockedReason: 'server_error',
      }
  }
}

export class ConnectionRuntime {
  #snapshot: ConnectionSnapshot
  #listeners = new Set<ConnectionListener>()
  #timer: unknown = null
  #running = false
  #inFlight: Promise<ConnectionSnapshot> | null = null

  readonly #options: Required<Omit<ConnectionRuntimeOptions, 'client'>> & { client: FactoruClient }

  constructor(options: ConnectionRuntimeOptions) {
    this.#options = {
      client: options.client,
      connectedIntervalMs: options.connectedIntervalMs ?? DEFAULT_CONNECTED_INTERVAL_MS,
      retryIntervalMs: options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS,
      now: options.now ?? (() => new Date()),
      setTimer: options.setTimer ?? ((handler, ms) => setTimeout(handler, ms)),
      clearTimer:
        options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
    }

    this.#snapshot = {
      state: 'unconfigured',
      serverUrl: options.client.baseUrl,
      health: null,
      negotiatedProtocolVersion: null,
      blockedReason: null,
      error: null,
      lastCheckedAt: null,
      lastConnectedAt: null,
    }
  }

  get snapshot(): ConnectionSnapshot {
    return this.#snapshot
  }

  subscribe(listener: ConnectionListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Begins periodic checks. Safe to call more than once. */
  start(): void {
    if (this.#running) return
    this.#running = true
    void this.refresh()
  }

  stop(): void {
    this.#running = false
    if (this.#timer !== null) {
      this.#options.clearTimer(this.#timer)
      this.#timer = null
    }
  }

  /** Runs one attempt. Concurrent callers share the in-flight attempt. */
  async refresh(): Promise<ConnectionSnapshot> {
    this.#inFlight ??= this.#attempt().finally(() => {
      this.#inFlight = null
    })
    return this.#inFlight
  }

  async #attempt(): Promise<ConnectionSnapshot> {
    this.#apply({ type: 'connect_requested' })

    try {
      // The server's own `compatible` flag is informational; the client acts on
      // the verdict it computed from its own protocol range.
      const { compatibility } = await this.#options.client.handshake()

      if (!compatibility.compatible) {
        this.#apply(
          { type: 'handshake_blocked', reason: 'incompatible_protocol' },
          {
            blockedReason: 'incompatible_protocol',
            negotiatedProtocolVersion: null,
            error: {
              code: 'unsupported_protocol_version',
              message: compatibility.incompatibility.message,
            },
            lastCheckedAt: this.#nowIso(),
          },
        )
        return this.#snapshot
      }

      const health = await this.#options.client.health()
      const checkedAt = this.#nowIso()
      this.#apply(
        { type: 'handshake_succeeded' },
        {
          health,
          negotiatedProtocolVersion: compatibility.negotiatedProtocolVersion,
          blockedReason: null,
          error: null,
          lastCheckedAt: checkedAt,
          lastConnectedAt: checkedAt,
        },
      )
      return this.#snapshot
    } catch (caught) {
      const error =
        caught instanceof FactoruProtocolError
          ? caught
          : new FactoruProtocolError('transport_error', String(caught), { cause: caught })
      const { event, blockedReason } = classify(error.code)

      this.#apply(event, {
        blockedReason,
        error: { code: error.code, message: error.message },
        lastCheckedAt: this.#nowIso(),
      })
      return this.#snapshot
    } finally {
      this.#scheduleNext()
    }
  }

  #scheduleNext(): void {
    if (!this.#running) return
    if (this.#timer !== null) {
      this.#options.clearTimer(this.#timer)
      this.#timer = null
    }

    /*
     * `blocked` means an incompatible protocol, a rejected credential, or an
     * invalid response: retrying cannot fix any of them, so polling would only
     * burn requests and log noise. The next attempt happens when the user asks
     * for one or the configuration changes, both of which call `refresh`.
     */
    if (this.#snapshot.state === 'blocked') return

    const delay =
      this.#snapshot.state === 'connected'
        ? this.#options.connectedIntervalMs
        : this.#options.retryIntervalMs

    this.#timer = this.#options.setTimer(() => {
      this.#timer = null
      void this.refresh()
    }, delay)
  }

  #nowIso(): string {
    return this.#options.now().toISOString()
  }

  #apply(event: ConnectionEvent, patch: Partial<ConnectionSnapshot> = {}): void {
    const state = nextConnectionState(this.#snapshot.state, event) ?? this.#snapshot.state
    const next: ConnectionSnapshot = { ...this.#snapshot, ...patch, state }

    const changed = (Object.keys(next) as (keyof ConnectionSnapshot)[]).some(
      (key) => next[key] !== this.#snapshot[key],
    )
    this.#snapshot = next
    if (changed) {
      for (const listener of this.#listeners) {
        listener(next)
      }
    }
  }
}
