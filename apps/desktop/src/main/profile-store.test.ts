import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '@factoru/protocol'
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
      kind: 'remote' as const,
      name: 'Server',
      url: 'https://factoru.test',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
      projects: [],
      workspaces: {},
      cursor: 0,
    }
    store.save(profile)
    store.save({ ...profile, url: 'https://new.factoru.test', cursor: 4 })
    expect(new ProfileStore(root).list()).toHaveLength(1)
    expect(new ProfileStore(root).get(profile.serverId)?.cursor).toBe(4)
  })

  it('loads profiles written before factory kinds as remote until identity reconciliation', () => {
    const root = directory()
    const serverId = `srv_${'1'.repeat(32)}`
    fs.writeFileSync(
      path.join(root, 'connection-profiles.json'),
      JSON.stringify({
        activeServerId: serverId,
        profiles: [
          {
            serverId,
            deviceId: 'dev_legacy',
            name: '127.0.0.1',
            url: 'http://127.0.0.1:38300',
            createdAt: new Date().toISOString(),
            lastConnectedAt: null,
            projects: [],
            selectedProjectId: null,
            workspaces: {},
            cursor: 0,
          },
        ],
      }),
    )

    expect(new ProfileStore(root).get(serverId)?.kind).toBe('remote')
  })

  it('migrates the active server project into a compound project reference', () => {
    const root = directory()
    const serverId = `srv_${'3'.repeat(32)}`
    fs.writeFileSync(
      path.join(root, 'connection-profiles.json'),
      JSON.stringify({
        activeServerId: serverId,
        profiles: [
          {
            serverId,
            deviceId: 'dev_legacy',
            kind: 'remote',
            name: 'Pi',
            url: 'http://127.0.0.1:28788',
            createdAt: new Date().toISOString(),
            lastConnectedAt: null,
            projects: [{ id: 'project_legacy' }],
            selectedProjectId: 'project_legacy',
            workspaces: {},
            cursor: 0,
          },
        ],
      }),
    )

    expect(new ProfileStore(root).activeProjectRef).toEqual({
      factoryId: serverId,
      projectId: 'project_legacy',
    })
  })

  it('persists completion of the one-time remote factory introduction', () => {
    const root = directory()
    const store = new ProfileStore(root)
    expect(store.remoteFactoryIntroComplete).toBe(false)
    store.completeRemoteFactoryIntro()
    expect(new ProfileStore(root).remoteFactoryIntroComplete).toBe(true)
  })

  it('updates an inactive profile without changing the active server', () => {
    const root = directory()
    const store = new ProfileStore(root)
    const first = {
      serverId: `srv_${'1'.repeat(32)}`,
      deviceId: 'dev_first',
      kind: 'remote' as const,
      name: 'First',
      url: 'http://127.0.0.1:18787',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
      projects: [],
      workspaces: {},
      cursor: 0,
    }
    const second = { ...first, serverId: `srv_${'2'.repeat(32)}`, name: 'Second' }
    store.save(first)
    store.save(second)

    store.update({ ...first, cursor: 9 })

    expect(store.get(first.serverId)?.cursor).toBe(9)
  })

  it('renames a profile without changing the active server or cached state', () => {
    const root = directory()
    const store = new ProfileStore(root)
    const first = {
      serverId: `srv_${'1'.repeat(32)}`,
      deviceId: 'dev_first',
      kind: 'remote' as const,
      name: 'First',
      url: 'http://127.0.0.1:18787',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
      projects: [],
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
    expect(new ProfileStore(root).get(first.serverId)).toEqual({
      ...first,
      name: 'Local Factory',
    })
    expect(() => store.rename(first.serverId, '   ')).toThrow(/required/)
  })

  it('clears the active project when its home factory is forgotten', () => {
    const root = directory()
    const store = new ProfileStore(root)
    const first = {
      serverId: `srv_${'1'.repeat(32)}`,
      deviceId: 'dev_first',
      kind: 'remote' as const,
      name: 'First',
      url: 'http://127.0.0.1:18787',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
      projects: [{ id: 'project_first' } as Project],
      workspaces: {},
      cursor: 0,
    }
    const second = { ...first, serverId: `srv_${'2'.repeat(32)}`, name: 'Second' }
    store.save(first)
    store.save(second)
    store.selectProject({ factoryId: second.serverId, projectId: 'project_first' })

    store.remove(second.serverId)

    expect(store.activeProjectRef).toBeNull()
  })

  it('adopts a legacy endpoint-named profile as the protected Local Factory', () => {
    const root = directory()
    const store = new ProfileStore(root)
    const local = {
      serverId: `srv_${'1'.repeat(32)}`,
      deviceId: 'dev_local',
      kind: 'remote' as const,
      name: '127.0.0.1',
      url: 'http://127.0.0.1:38300',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
      projects: [],
      workspaces: {},
      cursor: 0,
    }
    store.save(local)

    expect(store.adoptLocal(local.serverId, 'http://127.0.0.1:38304')).toEqual({
      ...local,
      kind: 'local',
      name: 'Local Factory',
      url: 'http://127.0.0.1:38304',
    })
    expect(() => store.remove(local.serverId)).toThrow(/cannot be forgotten/)
    expect(store.get(local.serverId)?.kind).toBe('local')
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
