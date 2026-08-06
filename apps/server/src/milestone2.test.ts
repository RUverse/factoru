import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { FactoruDatabase } from '@factoru/database'
import { parseServerId } from '@factoru/domain'
import type { RigRegistrar } from '@factoru/gas-city'
import {
  CAPABILITY_LOCAL_ENROLLMENT,
  CONNECTION_TICKET_PATH,
  HANDSHAKE_PATH,
  LOCAL_ENROLLMENT_PATH,
  PAIRING_EXCHANGE_PATH,
} from '@factoru/protocol'
import { buildServer } from './app.js'
import { ProjectService } from './project-service.js'
import { RepositoryService } from './repositories.js'

const directories: string[] = []
function fixtureDirectory() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-m2-'))
  directories.push(value)
  return value
}
afterEach(() => {
  for (const value of directories.splice(0)) fs.rmSync(value, { recursive: true })
})

function repositoryFixture() {
  const root = fixtureDirectory()
  const repository = path.join(root, 'project')
  fs.mkdirSync(repository)
  execFileSync('git', ['init', '-b', 'dev'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'test@factoru.local'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Factoru Test'], { cwd: repository })
  fs.writeFileSync(path.join(repository, 'README.md'), '# Test\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repository })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repository })
  return { root, repository }
}

describe('Milestone 2 server slice', () => {
  it('exchanges one pairing code for a hashed device token and one-time ticket', async () => {
    const directory = fixtureDirectory()
    const serverId = parseServerId('srv_11111111111111111111111111111111')
    const database = new FactoruDatabase(path.join(directory, 'factoru.sqlite'), serverId)
    database.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
    const projects = new ProjectService({
      database,
      repositories: new RepositoryService([]),
      registrar: { register: async () => undefined },
      cityName: 'factoru-test',
      cityPath: path.join(directory, 'city'),
    })
    const app = buildServer({ serverId, database, projectService: projects, logLevel: 'silent' })
    const paired = await app.inject({
      method: 'POST',
      url: PAIRING_EXCHANGE_PATH,
      payload: { code: 'ABCD-EFGH-JKMN', deviceName: 'Mac' },
    })
    expect(paired.statusCode).toBe(200)
    const token = paired.json().token as string
    expect(
      JSON.stringify(database.connection.prepare('SELECT * FROM trusted_devices').get()),
    ).not.toContain(token)
    const replay = await app.inject({
      method: 'POST',
      url: PAIRING_EXCHANGE_PATH,
      payload: { code: 'ABCD-EFGH-JKMN', deviceName: 'Mac' },
    })
    expect(replay.statusCode).toBe(401)
    const malformed = await app.inject({
      method: 'POST',
      url: PAIRING_EXCHANGE_PATH,
      payload: { code: 'not-a-code', deviceName: 'Mac' },
    })
    expect(malformed.statusCode).toBe(replay.statusCode)
    expect(malformed.json()).toEqual(replay.json())
    const ticket = await app.inject({
      method: 'POST',
      url: CONNECTION_TICKET_PATH,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(ticket.statusCode).toBe(200)
    expect(ticket.json().ticket).toHaveLength(43)
    await app.close()
    database.close()
  })

  it('enrolls a same-machine desktop without a user-entered pairing code', async () => {
    const directory = fixtureDirectory()
    const serverId = parseServerId('srv_11111111111111111111111111111111')
    const database = new FactoruDatabase(path.join(directory, 'factoru.sqlite'), serverId)
    const projects = new ProjectService({
      database,
      repositories: new RepositoryService([]),
      registrar: { register: async () => undefined },
      cityName: 'factoru-test',
      cityPath: path.join(directory, 'city'),
    })
    const proof = 'a'.repeat(43)
    const app = buildServer({
      serverId,
      database,
      projectService: projects,
      localEnrollmentProof: proof,
      logLevel: 'silent',
    })
    const handshake = await app.inject({
      method: 'POST',
      url: HANDSHAKE_PATH,
      payload: {
        clientName: 'factoru-desktop',
        clientVersion: '0.0.0',
        protocolVersion: 1,
        minProtocolVersion: 1,
      },
    })
    expect(handshake.json().server.capabilities).toContain(CAPABILITY_LOCAL_ENROLLMENT)
    const rejected = await app.inject({
      method: 'POST',
      url: LOCAL_ENROLLMENT_PATH,
      payload: { proof: 'b'.repeat(43), deviceName: 'Mac' },
    })
    expect(rejected.statusCode).toBe(401)
    const enrolled = await app.inject({
      method: 'POST',
      url: LOCAL_ENROLLMENT_PATH,
      payload: { proof, deviceName: 'Mac' },
    })
    expect(enrolled.statusCode).toBe(200)
    expect(database.authenticateDevice(enrolled.json().token)?.name).toBe('Mac')
    await app.close()
    database.close()
  })

  it('previews safely, creates durably, provisions asynchronously, and reopens the same project', async () => {
    const { root, repository } = repositoryFixture()
    const serverId = parseServerId('srv_11111111111111111111111111111111')
    const file = path.join(root, 'factoru.sqlite')
    const database = new FactoruDatabase(file, serverId)
    database.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
    const device = database.exchangePairingCode('ABCD-EFGH-JKMN', 'Mac')!.device
    const roots = [{ id: 'root_test', label: 'Repos', path: root }]
    const repositories = new RepositoryService(roots)
    const preview = await repositories.preview('root_test', 'project')
    expect(preview.preview.safe).toBe(true)
    const calls: unknown[] = []
    const registrar: RigRegistrar = {
      register: async (request) => {
        calls.push(request)
      },
    }
    const service = new ProjectService({
      database,
      repositories,
      registrar,
      cityName: 'factoru-test',
      cityPath: path.join(root, 'city'),
    })
    const created = await service.createProject(device, 'cmd_create', {
      rootId: 'root_test',
      relativePath: 'project',
      name: 'Project',
      defaultBranch: 'dev',
      fingerprint: preview.preview.fingerprint,
    })
    expect(created.setupState).toBe('setting_up')
    await service.processOutbox()
    expect(service.getProject(created.id).setupState).toBe('ready')
    expect(calls).toHaveLength(1)
    database.close()
    const reopened = new FactoruDatabase(file, serverId)
    expect(reopened.getProject(created.id)?.repositoryRealPath).toBe(fs.realpathSync(repository))
    reopened.close()
  }, 15_000)
})
