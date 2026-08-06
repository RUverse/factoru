import {
  checkCompatibility,
  LOCAL_PROTOCOL_RANGE,
  type CompatibilityResult,
} from './compatibility.js'
import { FactoruProtocolError, problemSchema } from './errors.js'
import {
  handshakeResponseSchema,
  healthResponseSchema,
  type HandshakeResponse,
  type HealthResponse,
} from './schemas.js'
import {
  HANDSHAKE_PATH,
  HEALTH_PATH,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from './version.js'
import {
  CONNECTION_TICKET_PATH,
  PAIRING_EXCHANGE_PATH,
  connectionTicketResponseSchema,
  pairingExchangeRequestSchema,
  pairingExchangeResponseSchema,
  type PairingExchangeResponse,
} from './milestone2.js'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface FactoruClientOptions {
  /** Base URL of a Factoru Server, for example `http://127.0.0.1:41234`. */
  baseUrl: string
  clientName: string
  clientVersion: string
  fetch?: FetchLike
  timeoutMs?: number
}

export interface RequestOptions {
  signal?: AbortSignal
}

export interface HandshakeOutcome {
  readonly response: HandshakeResponse
  /**
   * The client's own verdict. The server's `compatible` flag is informational;
   * the client never treats a connection as usable on the server's word alone.
   */
  readonly compatibility: CompatibilityResult
}

export interface FactoruClient {
  readonly baseUrl: string
  health(options?: RequestOptions): Promise<HealthResponse>
  handshake(options?: RequestOptions): Promise<HandshakeOutcome>
  pair(code: string, deviceName: string, options?: RequestOptions): Promise<PairingExchangeResponse>
  createConnectionTicket(
    token: string,
    options?: RequestOptions,
  ): Promise<{ ticket: string; expiresAt: string }>
}

const DEFAULT_TIMEOUT_MS = 5_000

function normalizeBaseUrl(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch (cause) {
    throw new FactoruProtocolError('invalid_request', `Invalid server URL: ${baseUrl}`, { cause })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FactoruProtocolError(
      'invalid_request',
      `Unsupported server URL scheme: ${url.protocol}`,
    )
  }
  return url.origin + url.pathname.replace(/\/$/, '')
}

export function createFactoruClient(options: FactoruClientOptions): FactoruClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const doFetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (typeof doFetch !== 'function') {
    throw new FactoruProtocolError('invalid_request', 'No fetch implementation is available')
  }

  async function request(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

    let response: Response
    try {
      response = await doFetch(`${baseUrl}${path}`, { ...init, signal: combined })
    } catch (cause) {
      if (timeout.aborted) {
        throw new FactoruProtocolError(
          'timeout',
          `Factoru Server did not respond within ${timeoutMs}ms`,
          {
            cause,
          },
        )
      }
      throw new FactoruProtocolError(
        'transport_error',
        `Could not reach Factoru Server at ${baseUrl}`,
        {
          cause,
        },
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch (cause) {
      throw new FactoruProtocolError(
        'invalid_response',
        'Factoru Server returned a non-JSON response',
        {
          status: response.status,
          cause,
        },
      )
    }

    if (!response.ok) {
      const parsed = problemSchema.safeParse(body)
      if (parsed.success) {
        throw new FactoruProtocolError(parsed.data.error.code, parsed.data.error.message, {
          status: response.status,
          details: parsed.data.error.details,
        })
      }
      throw new FactoruProtocolError(
        'invalid_response',
        `Factoru Server returned HTTP ${response.status}`,
        {
          status: response.status,
          details: body,
        },
      )
    }

    return body
  }

  return {
    baseUrl,

    async health(requestOptions = {}) {
      const body = await request(HEALTH_PATH, { method: 'GET' }, requestOptions.signal)
      const parsed = healthResponseSchema.safeParse(body)
      if (!parsed.success) {
        throw new FactoruProtocolError(
          'invalid_response',
          'Factoru Server sent an invalid health response',
          {
            details: parsed.error.issues,
          },
        )
      }
      return parsed.data
    },

    async handshake(requestOptions = {}) {
      const body = await request(
        HANDSHAKE_PATH,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            clientName: options.clientName,
            clientVersion: options.clientVersion,
            protocolVersion: PROTOCOL_VERSION,
            minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
          }),
        },
        requestOptions.signal,
      )

      const parsed = handshakeResponseSchema.safeParse(body)
      if (!parsed.success) {
        throw new FactoruProtocolError(
          'invalid_response',
          'Factoru Server sent an invalid handshake response',
          { details: parsed.error.issues },
        )
      }

      return {
        response: parsed.data,
        compatibility: checkCompatibility(LOCAL_PROTOCOL_RANGE, parsed.data.server),
      }
    },

    async pair(code, deviceName, requestOptions = {}) {
      const requestBody = pairingExchangeRequestSchema.parse({ code, deviceName })
      const body = await request(
        PAIRING_EXCHANGE_PATH,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
        requestOptions.signal,
      )
      const parsed = pairingExchangeResponseSchema.safeParse(body)
      if (!parsed.success) {
        throw new FactoruProtocolError(
          'invalid_response',
          'Factoru Server sent an invalid pairing response',
          {
            details: parsed.error.issues,
          },
        )
      }
      return parsed.data
    },

    async createConnectionTicket(token, requestOptions = {}) {
      const body = await request(
        CONNECTION_TICKET_PATH,
        { method: 'POST', headers: { authorization: `Bearer ${token}` } },
        requestOptions.signal,
      )
      const parsed = connectionTicketResponseSchema.safeParse(body)
      if (!parsed.success) {
        throw new FactoruProtocolError(
          'invalid_response',
          'Factoru Server sent an invalid connection ticket',
          {
            details: parsed.error.issues,
          },
        )
      }
      return parsed.data
    },
  }
}
