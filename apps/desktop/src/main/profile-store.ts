import fs from 'node:fs'
import path from 'node:path'
import type { Project } from '@factoru/protocol'

export interface ServerProfile {
  serverId: string
  deviceId: string
  name: string
  url: string
  createdAt: string
  lastConnectedAt: string | null
  projects: Project[]
  cursor: number
}

interface StoredProfiles {
  activeServerId: string | null
  profiles: ServerProfile[]
}

export class ProfileStore {
  readonly #file: string
  #state: StoredProfiles

  constructor(directory: string) {
    this.#file = path.join(directory, 'connection-profiles.json')
    this.#state = this.#read()
  }

  get activeServerId(): string | null {
    return this.#state.activeServerId
  }
  list(): ServerProfile[] {
    return structuredClone(this.#state.profiles)
  }
  active(): ServerProfile | null {
    return (
      this.#state.profiles.find((profile) => profile.serverId === this.#state.activeServerId) ??
      null
    )
  }

  save(profile: ServerProfile): void {
    const index = this.#state.profiles.findIndex((item) => item.serverId === profile.serverId)
    if (index === -1) this.#state.profiles.push(profile)
    else this.#state.profiles[index] = profile
    this.#state.activeServerId = profile.serverId
    this.#write()
  }

  activate(serverId: string): void {
    if (!this.#state.profiles.some((profile) => profile.serverId === serverId))
      throw new Error('profile_not_found')
    this.#state.activeServerId = serverId
    this.#write()
  }

  remove(serverId: string): void {
    this.#state.profiles = this.#state.profiles.filter((profile) => profile.serverId !== serverId)
    if (this.#state.activeServerId === serverId)
      this.#state.activeServerId = this.#state.profiles[0]?.serverId ?? null
    this.#write()
  }

  #read(): StoredProfiles {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8')) as StoredProfiles
      if (!Array.isArray(parsed.profiles)) throw new Error('invalid profiles')
      return parsed
    } catch {
      return { activeServerId: null, profiles: [] }
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
