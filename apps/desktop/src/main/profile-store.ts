import fs from 'node:fs'
import path from 'node:path'
import type { Project, Workspace } from '@factoru/protocol'
import { normalizeFactoryName } from '../shared/factory'

export interface ServerProfile {
  serverId: string
  deviceId: string
  kind: 'local' | 'remote'
  name: string
  url: string
  createdAt: string
  lastConnectedAt: string | null
  projects: Project[]
  workspaces: Record<string, Workspace>
  cursor: number
}

export interface StoredProjectRef {
  factoryId: string
  projectId: string
}

interface StoredProfiles {
  activeProjectRef: StoredProjectRef | null
  remoteFactoryIntroComplete: boolean
  profiles: ServerProfile[]
}

interface LegacyStoredProfiles {
  activeProjectRef?: StoredProjectRef | null
  activeServerId?: string | null
  remoteFactoryIntroComplete?: boolean
  profiles: Array<ServerProfile & { selectedProjectId?: string | null }>
}

export class ProfileStore {
  readonly #file: string
  #state: StoredProfiles

  constructor(directory: string) {
    this.#file = path.join(directory, 'connection-profiles.json')
    this.#state = this.#read()
  }

  get activeProjectRef(): StoredProjectRef | null {
    return this.#state.activeProjectRef ? { ...this.#state.activeProjectRef } : null
  }
  get remoteFactoryIntroComplete(): boolean {
    return this.#state.remoteFactoryIntroComplete
  }
  list(): ServerProfile[] {
    return structuredClone(this.#state.profiles)
  }
  get(serverId: string): ServerProfile | null {
    const profile = this.#state.profiles.find((item) => item.serverId === serverId)
    return profile ? structuredClone(profile) : null
  }
  save(profile: ServerProfile): void {
    const index = this.#state.profiles.findIndex((item) => item.serverId === profile.serverId)
    if (index === -1) this.#state.profiles.push(profile)
    else this.#state.profiles[index] = profile
    this.#write()
  }

  update(profile: ServerProfile): void {
    const index = this.#state.profiles.findIndex((item) => item.serverId === profile.serverId)
    if (index === -1) throw new Error('profile_not_found')
    this.#state.profiles[index] = profile
    this.#write()
  }

  selectProject(reference: StoredProjectRef | null): void {
    if (reference) {
      const profile = this.#state.profiles.find(
        (candidate) => candidate.serverId === reference.factoryId,
      )
      if (!profile?.projects.some((project) => project.id === reference.projectId)) {
        throw new Error('project_not_found')
      }
    }
    this.#state.activeProjectRef = reference ? { ...reference } : null
    this.#write()
  }

  completeRemoteFactoryIntro(): void {
    this.#state.remoteFactoryIntroComplete = true
    this.#write()
  }

  rename(serverId: string, name: string): ServerProfile {
    const index = this.#state.profiles.findIndex((profile) => profile.serverId === serverId)
    if (index === -1) throw new Error('profile_not_found')
    const current = this.#state.profiles[index]
    if (!current) throw new Error('profile_not_found')
    const profile: ServerProfile = { ...current, name: normalizeFactoryName(name) }
    this.#state.profiles[index] = profile
    this.#write()
    return structuredClone(profile)
  }

  adoptLocal(serverId: string, url: string): ServerProfile | null {
    const index = this.#state.profiles.findIndex((profile) => profile.serverId === serverId)
    if (index === -1) return null
    const current = this.#state.profiles[index]
    if (!current) return null
    const parsedUrl = new URL(current.url)
    const legacyNames = new Set([parsedUrl.host, parsedUrl.hostname, 'Local'])
    const profile: ServerProfile = {
      ...current,
      kind: 'local',
      name: legacyNames.has(current.name) ? 'Local Factory' : current.name,
      url,
    }
    this.#state.profiles[index] = profile
    this.#write()
    return structuredClone(profile)
  }

  remove(serverId: string): void {
    const profile = this.#state.profiles.find((item) => item.serverId === serverId)
    if (profile?.kind === 'local') throw new Error('Local Factory cannot be forgotten')
    this.#state.profiles = this.#state.profiles.filter((profile) => profile.serverId !== serverId)
    if (this.#state.activeProjectRef?.factoryId === serverId) this.#state.activeProjectRef = null
    this.#write()
  }

  #read(): StoredProfiles {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8')) as LegacyStoredProfiles
      if (!Array.isArray(parsed.profiles)) throw new Error('invalid profiles')
      const migratedProfile = parsed.activeServerId
        ? parsed.profiles.find((profile) => profile.serverId === parsed.activeServerId)
        : undefined
      const migratedProjectId = migratedProfile?.selectedProjectId
      const profiles = parsed.profiles.map((profile) => ({
        serverId: profile.serverId,
        deviceId: profile.deviceId,
        kind: profile.kind === 'local' ? ('local' as const) : ('remote' as const),
        name: profile.name,
        url: profile.url,
        createdAt: profile.createdAt,
        lastConnectedAt: profile.lastConnectedAt,
        projects: Array.isArray(profile.projects) ? profile.projects : [],
        workspaces:
          typeof profile.workspaces === 'object' && profile.workspaces !== null
            ? profile.workspaces
            : {},
        cursor: Number.isInteger(profile.cursor) ? profile.cursor : 0,
      }))
      const candidate =
        parsed.activeProjectRef ??
        (migratedProfile && typeof migratedProjectId === 'string'
          ? { factoryId: migratedProfile.serverId, projectId: migratedProjectId }
          : null)
      const activeProjectRef = candidate
        ? profiles.some(
            (profile) =>
              profile.serverId === candidate.factoryId &&
              profile.projects.some((project) => project.id === candidate.projectId),
          )
          ? candidate
          : null
        : null
      return {
        activeProjectRef,
        remoteFactoryIntroComplete: parsed.remoteFactoryIntroComplete === true,
        profiles,
      }
    } catch {
      return { activeProjectRef: null, remoteFactoryIntroComplete: false, profiles: [] }
    }
  }

  #write(): void {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    const temporary = `${this.#file}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, this.#file)
  }
}

export interface SecretEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export class CredentialStore {
  readonly #file: string
  readonly #encryption: SecretEncryption
  #values: Record<string, string>

  constructor(directory: string, encryption: SecretEncryption) {
    this.#file = path.join(directory, 'credentials.enc.json')
    this.#encryption = encryption
    if (!encryption.isEncryptionAvailable())
      throw new Error('OS credential encryption is unavailable')
    try {
      this.#values = JSON.parse(fs.readFileSync(this.#file, 'utf8')) as Record<string, string>
    } catch {
      this.#values = {}
    }
  }

  get(serverId: string): string | null {
    const value = this.#values[serverId]
    return value ? this.#encryption.decryptString(Buffer.from(value, 'base64')) : null
  }

  set(serverId: string, token: string): void {
    this.#values[serverId] = this.#encryption.encryptString(token).toString('base64')
    this.#write()
  }

  delete(serverId: string): void {
    delete this.#values[serverId]
    this.#write()
  }

  #write(): void {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    fs.writeFileSync(this.#file, `${JSON.stringify(this.#values, null, 2)}\n`, { mode: 0o600 })
  }
}

export function normalizeProfileUrl(raw: string): string {
  const url = new URL(raw)
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Remote Factoru Server profiles require HTTPS')
  }
  return url.origin + url.pathname.replace(/\/$/, '')
}
