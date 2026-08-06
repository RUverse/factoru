import WebSocket from 'ws'
import {
  createFactoruClient,
  liveEventSchema,
  liveResponseSchema,
  type LiveMethod,
} from '@factoru/protocol'

export class LiveFactoruClient {
  readonly #baseUrl: string
  readonly #token: string
  readonly #clientName: string
  readonly #clientVersion: string
  #socket: WebSocket | null = null
  #sequence = 0
  readonly #pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >()
  #eventListener: ((event: unknown) => void) | null = null
  #closeListener: (() => void) | null = null

  constructor(options: {
    baseUrl: string
    token: string
    clientName: string
    clientVersion: string
  }) {
    this.#baseUrl = options.baseUrl
    this.#token = options.token
    this.#clientName = options.clientName
    this.#clientVersion = options.clientVersion
  }

  onEvent(listener: (event: unknown) => void): void {
    this.#eventListener = listener
  }
  onClose(listener: () => void): void {
    this.#closeListener = listener
  }

  async connect(): Promise<void> {
    const client = createFactoruClient({
      baseUrl: this.#baseUrl,
      clientName: this.#clientName,
      clientVersion: this.#clientVersion,
    })
    const { ticket } = await client.createConnectionTicket(this.#token)
    const url = new URL(this.#baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/live`
    url.searchParams.set('ticket', ticket)
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
      this.#socket = socket
      socket.once('open', () => resolve())
      socket.once('error', reject)
      socket.on('message', (raw) => this.#handle(raw.toString()))
      socket.on('close', () => {
        for (const pending of this.#pending.values())
          pending.reject(new Error('Live connection closed'))
        this.#pending.clear()
        this.#closeListener?.()
      })
    })
  }

  close(): void {
    this.#socket?.close()
    this.#socket = null
  }

  request(method: LiveMethod, params: unknown = {}, commandId?: string): Promise<unknown> {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Not connected'))
    const id = `req_${++this.#sequence}`
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket!.send(
        JSON.stringify({ id, method, params, ...(commandId ? { commandId } : {}) }),
      )
    })
  }

  #handle(raw: string): void {
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return
    }
    const event = liveEventSchema.safeParse(body)
    if (event.success) {
      this.#eventListener?.(event.data.event)
      return
    }
    const response = liveResponseSchema.safeParse(body)
    if (!response.success) return
    const pending = this.#pending.get(response.data.id)
    if (!pending) return
    this.#pending.delete(response.data.id)
    if (response.data.ok) pending.resolve(response.data.result)
    else
      pending.reject(
        Object.assign(new Error(response.data.error.message), { code: response.data.error.code }),
      )
  }
}
