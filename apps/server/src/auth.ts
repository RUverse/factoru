import { randomBytes } from 'node:crypto'
import type { FactoruDatabase, OwnerScope, TrustedDevice } from '@factoru/database'

interface Ticket {
  device: TrustedDevice
  expiresAt: number
}

export class TicketStore {
  readonly #tickets = new Map<string, Ticket>()

  issue(device: TrustedDevice, now = Date.now()): { ticket: string; expiresAt: string } {
    for (const [value, stored] of this.#tickets) {
      if (stored.expiresAt <= now) this.#tickets.delete(value)
    }
    if (this.#tickets.size >= 1_024) this.#tickets.delete(this.#tickets.keys().next().value!)
    const ticket = randomBytes(32).toString('base64url')
    const expiresAt = now + 60_000
    this.#tickets.set(ticket, { device, expiresAt })
    return { ticket, expiresAt: new Date(expiresAt).toISOString() }
  }

  consume(ticket: string, now = Date.now()): TrustedDevice | null {
    const stored = this.#tickets.get(ticket)
    this.#tickets.delete(ticket)
    return stored && stored.expiresAt > now ? stored.device : null
  }
}

export function bearerDevice(
  database: FactoruDatabase,
  authorization?: string,
): TrustedDevice | null {
  if (!authorization?.startsWith('Bearer ')) return null
  return database.authenticateDevice(authorization.slice(7))
}

export function requireScope(device: TrustedDevice, scope: OwnerScope): void {
  if (!device.scopes.includes(scope)) throw new Error('forbidden')
}
