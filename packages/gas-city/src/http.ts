import { GAS_CITY_REQUEST_HEADER, SUPERVISOR_API_PREFIX } from './compatibility.js'
import { GasCityError, problemToError } from './errors.js'

/**
 * The supervisor's HTTP surface, wrapped so that nothing above this file deals
 * in status codes, header names, or Gas City's error envelope.
 *
 * Two properties of the real supervisor shape this client:
 *
 * 1. It declares no authentication scheme at all. Its safety comes entirely
 *    from binding to loopback. Factoru therefore treats the base URL as a
 *    host-local trust assumption and refuses a non-loopback one, rather than
 *    letting a configuration mistake put an unauthenticated control plane on a
 *    network interface.
 * 2. Every mutation requires the `X-GC-Request` header. The server checks only
 *    that it is present, so it is an anti-CSRF measure and never authorization.
 */

export interface SupervisorClientOptions {
  /** Supervisor base URL, for example `http://127.0.0.1:8372`. */
  readonly baseUrl: string
  /** Per-request timeout. Defaults to 30s. */
  readonly timeoutMs?: number
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch
}

export interface ServerSentEvent {
  readonly event: string
  readonly data: string
  readonly id: string | undefined
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Whether a supervisor URL points at this host.
 *
 * Gas City's control plane is unauthenticated, so a non-loopback base URL is
 * not a deployment choice Factoru can honour — it is a security failure.
 */
export function isLoopbackUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  return LOOPBACK_HOSTNAMES.has(url.hostname)
}

export class SupervisorClient {
  readonly #baseUrl: string
  readonly #timeoutMs: number
  readonly #fetch: typeof globalThis.fetch

  constructor(options: SupervisorClientOptions) {
    if (!isLoopbackUrl(options.baseUrl)) {
      throw new GasCityError(
        `Refusing to use Gas City supervisor at ${options.baseUrl}: its control plane is ` +
          'unauthenticated and must stay host-local. Factoru never reaches a remote supervisor ' +
          'directly, and never proxies one to a desktop client.',
        { kind: 'invalid_request' },
      )
    }

    this.#baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.#timeoutMs = options.timeoutMs ?? 30_000
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  get baseUrl(): string {
    return this.#baseUrl
  }

  /** Read from a versioned supervisor path, for example `/city/foo/status`. */
  async get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    return this.#request('GET', path, { query })
  }

  /**
   * Read from a path outside the `/v0` prefix.
   *
   * Only the served OpenAPI document lives there. Kept separate from `get` so
   * the version prefix stays a property of the client rather than something
   * each call site remembers.
   */
  async getAbsolute(path: string): Promise<unknown> {
    return this.#request('GET', path, { query: undefined, unversioned: true })
  }

  /**
   * Mutate through a versioned supervisor path.
   *
   * `idempotencyKey` is forwarded where the supervisor supports it. A `202` is
   * not treated as completion by anything above this client: callers correlate
   * a terminal event or re-read the resource.
   */
  async post(
    path: string,
    body?: unknown,
    options?: { idempotencyKey?: string },
  ): Promise<unknown> {
    return this.#request('POST', path, { body, idempotencyKey: options?.idempotencyKey })
  }

  /** Open a versioned SSE endpoint and yield complete frames until aborted. */
  async *stream(
    path: string,
    query: Record<string, string | number | undefined>,
    signal: AbortSignal,
  ): AsyncGenerator<ServerSentEvent> {
    const url = new URL(`${this.#baseUrl}${SUPERVISOR_API_PREFIX}${path}`)
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    let response: Response
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal,
      })
    } catch (cause) {
      if (signal.aborted) return
      throw new GasCityError(`Gas City supervisor stream is unreachable at ${this.#baseUrl}`, {
        kind: 'transport',
        cause,
      })
    }
    const requestId = response.headers.get('X-GC-Request-Id') ?? undefined
    if (!response.ok) {
      const body = await response.text()
      throw problemToError(
        response.status,
        body.length > 0 ? safeJsonParse(body) : undefined,
        requestId,
      )
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      throw new GasCityError('Gas City returned a non-SSE response for an event stream', {
        kind: 'transport',
      })
    }
    if (!response.body) {
      throw new GasCityError('Gas City returned an empty event stream body', { kind: 'transport' })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = ''
    let eventId: string | undefined
    let data: string[] = []
    const dispatch = (): ServerSentEvent | null => {
      if (data.length === 0) {
        eventName = ''
        eventId = undefined
        return null
      }
      const frame = { event: eventName || 'message', data: data.join('\n'), id: eventId }
      eventName = ''
      eventId = undefined
      data = []
      return frame
    }
    const consumeLine = (line: string): ServerSentEvent | null => {
      if (line === '') return dispatch()
      if (line.startsWith(':')) return null
      const separator = line.indexOf(':')
      const field = separator === -1 ? line : line.slice(0, separator)
      let value = separator === -1 ? '' : line.slice(separator + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') eventName = value
      else if (field === 'data') data.push(value)
      else if (field === 'id' && !value.includes('\0')) eventId = value
      return null
    }

    try {
      while (!signal.aborted) {
        const next = await reader.read()
        buffer += decoder.decode(next.value, { stream: !next.done })
        let match: RegExpExecArray | null
        const lineBreak = /\r\n|\r|\n/g
        let start = 0
        while ((match = lineBreak.exec(buffer)) !== null) {
          const frame = consumeLine(buffer.slice(start, match.index))
          if (frame) yield frame
          start = match.index + match[0].length
        }
        buffer = buffer.slice(start)
        if (next.done) break
      }
      if (buffer.length > 0) consumeLine(buffer)
      const finalFrame = dispatch()
      if (finalFrame) yield finalFrame
    } finally {
      reader.releaseLock()
    }
  }

  async #request(
    method: 'GET' | 'POST',
    path: string,
    options: {
      query?: Record<string, string | number | undefined> | undefined
      body?: unknown
      idempotencyKey?: string | undefined
      unversioned?: boolean
    },
  ): Promise<unknown> {
    const prefix = options.unversioned ? '' : SUPERVISOR_API_PREFIX
    const url = new URL(`${this.#baseUrl}${prefix}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (method !== 'GET') {
      // Presence is what the supervisor checks. A descriptive value costs
      // nothing and makes Gas City's own logs readable during diagnosis.
      headers[GAS_CITY_REQUEST_HEADER] = 'factoru'
      if (options.body !== undefined) headers['Content-Type'] = 'application/json'
      if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
    }

    const signal = AbortSignal.timeout(this.#timeoutMs)

    let response: Response
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
      })
    } catch (cause) {
      throw new GasCityError(`Gas City supervisor is unreachable at ${this.#baseUrl}`, {
        kind: 'transport',
        cause,
      })
    }

    // Gas City names this header `X-GC-Request-Id`, not the more common
    // `X-Request-Id`. Reading the wrong one leaves every error without the
    // identifier needed to find it in Gas City's own logs.
    const requestId = response.headers.get('X-GC-Request-Id') ?? undefined

    const text = await response.text()
    const parsed = text.length > 0 ? safeJsonParse(text) : undefined

    if (!response.ok) {
      throw problemToError(response.status, parsed, requestId)
    }

    return parsed
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    // A non-JSON body from a JSON API is itself the failure; returning the raw
    // text lets the error carry something useful instead of an empty object.
    return { detail: text }
  }
}
