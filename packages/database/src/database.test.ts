import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseServerId } from '@factoru/domain'
import { FactoruDatabase } from './database.js'

const directories: string[] = []

function fixture(server = 'srv_11111111111111111111111111111111') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-db-'))
  directories.push(directory)
  const file = path.join(directory, 'factoru.sqlite')
  return { directory, file, db: new FactoruDatabase(file, parseServerId(server)) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('FactoruDatabase', () => {
  it('creates, migrates, configures, and reopens a server-bound database', () => {
    const { file, db } = fixture()
    expect(db.connection.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.connection.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.connection.pragma('busy_timeout', { simple: true })).toBe(5_000)
    expect(() => db.checkpoint()).not.toThrow()
    db.close()

    const reopened = new FactoruDatabase(
      file,
      parseServerId('srv_11111111111111111111111111111111'),
    )
    expect(reopened.connection.prepare('SELECT COUNT(*) AS count FROM migrations').get()).toEqual({
      count: 12,
    })
    reopened.close()
  })

  it('refuses to attach a database to another server identity', () => {
    const { file, db } = fixture()
    db.close()
    expect(
      () => new FactoruDatabase(file, parseServerId('srv_22222222222222222222222222222222')),
    ).toThrow(/belongs to/)
  })

  it('stores only hashed one-time pairing credentials and supports revocation', () => {
    const { db } = fixture()
    db.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
    const stored = db.connection.prepare('SELECT code_hash FROM pairing_codes').get() as {
      code_hash: string
    }
    expect(stored.code_hash).not.toContain('ABCD')

    const issued = db.exchangePairingCode('ABCD-EFGH-JKMN', 'Alireza’s Mac')!
    expect(db.exchangePairingCode('ABCD-EFGH-JKMN', 'Again')).toBeNull()
    expect(db.authenticateDevice(issued.token)?.id).toBe(issued.device.id)
    expect(db.revokeDevice(issued.device.id)).toBe(true)
    expect(db.authenticateDevice(issued.token)).toBeNull()
    db.close()
  })

  it('issues a trusted device without consuming a remote pairing code', () => {
    const { db } = fixture()
    const issued = db.createTrustedDevice('Local desktop')
    expect(issued.device.name).toBe('Local desktop')
    expect(db.authenticateDevice(issued.token)?.id).toBe(issued.device.id)
    expect(
      JSON.stringify(db.connection.prepare('SELECT * FROM trusted_devices').get()),
    ).not.toContain(issued.token)
    db.close()
  })

  it('commits project state, event, receipt, and outbox atomically and replays a receipt', () => {
    const { db } = fixture()
    db.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
    const device = db.exchangePairingCode('ABCD-EFGH-JKMN', 'Mac')!.device
    const input = {
      commandId: 'cmd_create_1',
      deviceId: device.id,
      requestHash: 'request-hash',
      projectId: 'prj_11111111111111111111111111111111',
      name: 'Factoru',
      repositoryRootId: 'root_main',
      repositoryRelativePath: 'factoru',
      repositoryRealPath: '/srv/repos/factoru',
      defaultBranch: 'dev',
      cityName: 'factoru-city',
      rigName: 'factoru-prj11111111',
      beadPrefix: 'f1111111',
    }
    const created = db.createProject(input)
    expect(created.setupState).toBe('setting_up')
    expect(created.repositories).toHaveLength(1)
    expect(db.createProject(input)).toEqual(created)
    expect(db.currentSequence()).toBe(1)
    expect(db.claimDueOutbox()).toHaveLength(1)
    expect(db.recoverUnfinishedOutbox()).toBe(1)
    const [retrying] = db.claimDueOutbox()
    expect(retrying).toBeDefined()
    const retryProjection = db.failProvisioning(
      retrying!.id,
      input.projectId,
      retrying!.attemptCount,
      'gas_city_registration_failed',
      'Gas City setup was interrupted.',
      retrying!.repositoryId,
    )
    expect(retryProjection).toMatchObject({
      setupState: 'setting_up',
      setupErrorCode: 'gas_city_registration_failed',
      repositories: [
        {
          retry: { attemptCount: 2, nextAttemptAt: expect.any(String) },
          rig: {
            registrationState: 'pending',
            lastErrorCode: 'gas_city_registration_failed',
            lastErrorMessage: 'Gas City setup was interrupted.',
          },
        },
      ],
    })
    expect(db.eventsAfter(0).at(-1)?.type).toBe('project.setup_retry_scheduled')
    expect(() => db.createProject({ ...input, requestHash: 'different' })).toThrow(
      'command_id_conflict',
    )
    db.close()
  })

  it('replays generic product commands and rejects command id reuse with different input', () => {
    const { db } = fixture()
    db.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
    const device = db.exchangePairingCode('ABCD-EFGH-JKMN', 'Mac')!.device
    let executions = 0
    const execute = (text: string) =>
      db.executeCommand('cmd_message_1', device.id, 'conversations.send', { text }, () => {
        executions += 1
        return { id: 'msg_1', text }
      })

    expect(execute('Ship it')).toEqual({ id: 'msg_1', text: 'Ship it' })
    expect(execute('Ship it')).toEqual({ id: 'msg_1', text: 'Ship it' })
    expect(executions).toBe(1)
    expect(() => execute('Change it')).toThrow('command_id_conflict')
    db.close()
  })

  it('keeps a multi-rig project in needs attention when another rig finishes later', () => {
    const { db } = fixture()
    const device = db.createTrustedDevice('Mac').device
    const projectId = 'prj_22222222222222222222222222222222'
    const project = db.createProject({
      commandId: 'cmd_multi_project',
      deviceId: device.id,
      requestHash: 'multi-request',
      projectId,
      name: 'Platform',
      repositoryRootId: 'root_main',
      repositoryRelativePath: 'web',
      repositoryRealPath: '/srv/repos/web',
      defaultBranch: 'main',
      cityName: 'factoru-city',
      rigName: 'factoru-web',
      beadPrefix: 'fweb001',
      repositories: [
        {
          id: 'repo_web',
          isPrimary: true,
          repositoryRootId: 'root_main',
          repositoryRelativePath: 'web',
          repositoryRealPath: '/srv/repos/web',
          defaultBranch: 'main',
          cityName: 'factoru-city',
          rigName: 'factoru-web',
          beadPrefix: 'fweb001',
        },
        {
          id: 'repo_api',
          isPrimary: false,
          repositoryRootId: 'root_main',
          repositoryRelativePath: 'api',
          repositoryRealPath: '/srv/repos/api',
          defaultBranch: 'main',
          cityName: 'factoru-city',
          rigName: 'factoru-api',
          beadPrefix: 'fapi001',
        },
      ],
    })
    expect(project.repositories).toHaveLength(2)
    const outbox = db.claimDueOutbox()
    const failed = outbox.find((item) => item.repositoryId === 'repo_web')!
    const succeeded = outbox.find((item) => item.repositoryId === 'repo_api')!
    db.failProvisioning(failed.id, projectId, 6, 'registration_failed', 'No rig', 'repo_web')
    db.completeProvisioning(succeeded.id, projectId, 'repo_api')
    expect(db.getProject(projectId)).toMatchObject({
      setupState: 'needs_attention',
      setupErrorCode: 'registration_failed',
    })
    db.close()
  })

  it('backs up a consistent database that can be reopened', async () => {
    const { directory, db } = fixture()
    const backup = path.join(directory, 'backup.sqlite')
    await db.backup(backup)
    expect(db.storageHealth()).toMatchObject({ databaseBytes: expect.any(Number) })
    db.close()
    const restored = new FactoruDatabase(
      backup,
      parseServerId('srv_11111111111111111111111111111111'),
    )
    expect(restored.currentSequence()).toBe(0)
    restored.close()
  })
})
