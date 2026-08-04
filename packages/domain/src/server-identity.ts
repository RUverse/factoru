import { randomUUID } from 'node:crypto'

/**
 * A Factoru Server's stable identity.
 *
 * Desktop connection profiles bind cached data and, from Milestone 2,
 * credentials to this value rather than to a hostname that may change.
 */
export type ServerId = string & { readonly __brand: 'ServerId' }

const SERVER_ID_PATTERN = /^srv_[0-9a-f]{32}$/

export class InvalidServerIdError extends Error {
  constructor(readonly value: string) {
    super(`Invalid Factoru server id: ${JSON.stringify(value)}`)
    this.name = 'InvalidServerIdError'
  }
}

export function isServerId(value: unknown): value is ServerId {
  return typeof value === 'string' && SERVER_ID_PATTERN.test(value)
}

export function parseServerId(value: string): ServerId {
  if (!isServerId(value)) {
    throw new InvalidServerIdError(value)
  }
  return value
}

export function createServerId(): ServerId {
  return `srv_${randomUUID().replaceAll('-', '')}` as ServerId
}
