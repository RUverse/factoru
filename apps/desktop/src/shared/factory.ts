import type { ServerProfileSummary } from './product'

export const FACTORY_NAME_MAX_LENGTH = 64

export function normalizeFactoryName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Factory name is required')
  if (name.length > FACTORY_NAME_MAX_LENGTH) {
    throw new Error(`Factory name must be ${FACTORY_NAME_MAX_LENGTH} characters or fewer`)
  }
  return name
}

export function factoryStatusLabel(value: ServerProfileSummary['connectionState']): string {
  switch (value) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting'
    case 'offline':
      return 'Offline'
    case 'blocked':
      return 'Blocked'
    case 'pairing_required':
      return 'Pairing required'
  }
}

export function factoryAggregateStatus(
  profiles: Array<Pick<ServerProfileSummary, 'connectionState'>>,
): { label: string; state: 'connected' | 'connecting' | 'offline' } {
  const online = profiles.filter((profile) => profile.connectionState === 'connected').length
  if (online > 0) {
    return {
      label: `${online} ${online === 1 ? 'factory' : 'factories'} online`,
      state: 'connected',
    }
  }
  if (profiles.some((profile) => profile.connectionState === 'connecting')) {
    return { label: 'Connecting to factories…', state: 'connecting' }
  }
  return { label: 'No factories online', state: 'offline' }
}
