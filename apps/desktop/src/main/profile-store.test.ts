import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialStore, normalizeProfileUrl, ProfileStore } from './profile-store'

const directories: string[] = []
function directory() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-profiles-'))
  directories.push(value)
  return value
}
afterEach(() => {
  for (const value of directories.splice(0)) fs.rmSync(value, { recursive: true })
})

describe('connection profiles', () => {
  it('requires HTTPS except for parsed loopback hosts', () => {
    expect(normalizeProfileUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787')
    expect(normalizeProfileUrl('https://factoru.example.test/')).toBe(
      'https://factoru.example.test',
    )
    expect(() => normalizeProfileUrl('http://factoru.example.test')).toThrow(/HTTPS/)
    expect(() => normalizeProfileUrl('http://127.0.0.1.evil.test')).toThrow(/HTTPS/)
  })

  it('merges profiles by stable server identity and keeps cached projects', () => {
    const root = directory()
    const store = new ProfileStore(root)
    const profile = {
      serverId: 'srv_11111111111111111111111111111111',
      deviceId: 'dev_1111',
      name: 'Server',
      url: 'https://factoru.test',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
      projects: [],
      selectedProjectId: null,
      workspaces: {},
      cursor: 0,
    }
    store.save(profile)
    store.save({ ...profile, url: 'https://new.factoru.test', cursor: 4 })
    expect(new ProfileStore(root).list()).toHaveLength(1)
    expect(new ProfileStore(root).active()?.cursor).toBe(4)
  })

  it('updates an inactive profile without changing the active server', () => {
    const root = directory()
    const store = new ProfileStore(root)
    const first = {
      serverId: `srv_${'1'.repeat(32)}`,
      deviceId: 'dev_first',
      name: 'First',
      url: 'http://127.0.0.1:18787',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
      projects: [],
      selectedProjectId: null,
      workspaces: {},
      cursor: 0,
    }
    const second = { ...first, serverId: `srv_${'2'.repeat(32)}`, name: 'Second' }
    store.save(first)
    store.save(second)

    store.update({ ...first, cursor: 9 })

    expect(store.active()?.serverId).toBe(second.serverId)
    expect(store.get(first.serverId)?.cursor).toBe(9)
  })

  it('renames a profile without changing the active server or cached state', () => {
    const root = directory()
    const store = new ProfileStore(root)
    const first = {
      serverId: `srv_${'1'.repeat(32)}`,
      deviceId: 'dev_first',
      name: 'First',
      url: 'http://127.0.0.1:18787',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
      projects: [],
      selectedProjectId: null,
      workspaces: {},
      cursor: 7,
    }
    const second = { ...first, serverId: `srv_${'2'.repeat(32)}`, name: 'Second' }
    store.save(first)
    store.save(second)

    expect(store.rename(first.serverId, '  Local Factory  ')).toEqual({
      ...first,
      name: 'Local Factory',
    })
    expect(store.active()?.serverId).toBe(second.serverId)
    expect(new ProfileStore(root).get(first.serverId)).toEqual({
      ...first,
      name: 'Local Factory',
    })
    expect(() => store.rename(first.serverId, '   ')).toThrow(/required/)
  })

  it('selects a deterministic fallback when an active profile is forgotten', () => {
    const root = directory()
    const store = new ProfileStore(root)
    const first = {
      serverId: `srv_${'1'.repeat(32)}`,
      deviceId: 'dev_first',
      name: 'First',
      url: 'http://127.0.0.1:18787',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
      projects: [],
      selectedProjectId: null,
      workspaces: {},
      cursor: 0,
    }
    const second = { ...first, serverId: `srv_${'2'.repeat(32)}`, name: 'Second' }
    store.save(first)
    store.save(second)

    store.remove(second.serverId)

    expect(store.active()?.serverId).toBe(first.serverId)
  })

  it('never persists a credential in plaintext', () => {
    const root = directory()
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
      decryptString: (value: Buffer) => value.toString().replace('encrypted:', ''),
    }
    const store = new CredentialStore(root, encryption)
    store.set('srv_1', 'secret-device-token')
    expect(store.get('srv_1')).toBe('secret-device-token')
    expect(fs.readFileSync(path.join(root, 'credentials.enc.json'), 'utf8')).not.toContain(
      'secret-device-token',
    )
  })
})
