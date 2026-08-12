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
  CAPABILITY_REPOSITORY_ACCESS_CHECK,
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
function projectsRoot(directory: string) {
  return { id: 'root_projects', label: 'Projects', path: path.join(directory, 'managed-projects') }
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
      repositories: new RepositoryService([], projectsRoot(directory)),
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
      repositories: new RepositoryService([], projectsRoot(directory)),
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
    expect(handshake.json().server.capabilities).toContain(CAPABILITY_REPOSITORY_ACCESS_CHECK)
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
    const secondRepository = path.join(root, 'api')
    fs.mkdirSync(secondRepository)
    execFileSync('git', ['init', '-b', 'main'], { cwd: secondRepository })
    execFileSync('git', ['config', 'user.email', 'test@factoru.local'], {
      cwd: secondRepository,
    })
    execFileSync('git', ['config', 'user.name', 'Factoru Test'], { cwd: secondRepository })
    fs.writeFileSync(path.join(secondRepository, 'README.md'), '# API\n')
    execFileSync('git', ['add', 'README.md'], { cwd: secondRepository })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: secondRepository })
    const serverId = parseServerId('srv_11111111111111111111111111111111')
    const file = path.join(root, 'factoru.sqlite')
    const database = new FactoruDatabase(file, serverId)
    database.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
    const device = database.exchangePairingCode('ABCD-EFGH-JKMN', 'Mac')!.device
    const roots = [{ id: 'root_test', label: 'Repos', path: root }]
    const repositories = new RepositoryService(roots, projectsRoot(root))
    const preview = await repositories.preview('root_test', 'project')
    const secondPreview = await repositories.preview('root_test', 'api')
    expect(preview.preview.safe).toBe(true)
    expect(await repositories.previewAbsolute(repository)).toMatchObject({
      rootId: 'root_test',
      relativePath: 'project',
    })
    const managedProject = repositories.planProjectDirectory(
      'prj_11111111111111111111111111111111',
      'My Project',
    )
    expect(repositories.planClone('https://example.com/org/api.git', managedProject)).toMatchObject(
      {
        sourceUrl: 'https://example.com/org/api.git',
        repository: {
          root: { id: 'root_projects' },
          relativePath: expect.stringMatching(/^my-project-11111111\/repositories\/api-/),
        },
      },
    )
    await expect(
      repositories.clone('file:///tmp/repository', 'root_projects', 'project/repositories/repo'),
    ).rejects.toMatchObject({ code: 'repository_url_invalid' })
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
      name: 'Project',
      repositories: [
        {
          kind: 'local',
          rootId: 'root_test',
          relativePath: 'project',
          defaultBranch: 'dev',
          fingerprint: preview.preview.fingerprint,
        },
        {
          kind: 'local',
          rootId: 'root_test',
          relativePath: 'api',
          defaultBranch: 'main',
          fingerprint: secondPreview.preview.fingerprint,
        },
      ],
    })
    expect(created.setupState).toBe('setting_up')
    expect(created.projectDirectory).toMatchObject({ managed: true })
    expect(created.repositories).toHaveLength(2)
    expect(created.repositories[0]?.isPrimary).toBe(true)
    await service.processOutbox()
    expect(service.getProject(created.id).setupState).toBe('ready')
    expect(calls).toHaveLength(2)
    database.close()
    const reopened = new FactoruDatabase(file, serverId)
    const reopenedProject = reopened.getProject(created.id)
    expect(reopenedProject?.repositoryRealPath).not.toBe(fs.realpathSync(repository))
    expect(reopenedProject?.repositoryRealPath).toContain(
      `${path.sep}managed-projects${path.sep}${created.projectDirectory?.name}${path.sep}repositories${path.sep}`,
    )
    expect(reopenedProject?.managedProjectDirectory).toBe(true)
    expect(reopenedProject?.repositories.map((item) => item.sourceRepositoryRealPath)).toEqual([
      fs.realpathSync(repository),
      fs.realpathSync(secondRepository),
    ])
    expect(reopened.getProject(created.id)?.repositories).toHaveLength(2)
    reopened.close()
  }, 15_000)

  it('persists remote repository intent before the provisioning reactor clones it', async () => {
    const root = fixtureDirectory()
    const database = new FactoruDatabase(
      path.join(root, 'factoru.sqlite'),
      parseServerId('srv_11111111111111111111111111111111'),
    )
    const device = database.createTrustedDevice('Mac').device
    const repositories = new RepositoryService(
      [{ id: 'root_test', label: 'Repos', path: root }],
      projectsRoot(root),
      async () => ({ stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }),
    )
    const service = new ProjectService({
      database,
      repositories,
      registrar: { register: async () => undefined },
      cityName: 'factoru-test',
      cityPath: path.join(root, 'city'),
    })
    const created = await service.createProject(device, 'cmd_remote', {
      name: 'Remote platform',
      repositories: [
        { kind: 'remote', rootId: 'root_test', url: 'https://example.com/org/api.git' },
      ],
    })
    expect(created.repositories[0]).toMatchObject({
      isPrimary: true,
      sourceUrl: 'https://example.com/org/api.git',
      defaultBranch: 'HEAD',
      rig: { registrationState: 'pending' },
    })
    expect(created.projectDirectory).toMatchObject({ managed: true })
    expect(fs.existsSync(path.join(root, 'managed-projects', created.projectDirectory!.name))).toBe(
      false,
    )
    expect(database.claimDueOutbox()).toHaveLength(1)
    database.close()
  })

  it('persists nothing when any remote repository is inaccessible', async () => {
    const root = fixtureDirectory()
    const database = new FactoruDatabase(
      path.join(root, 'factoru.sqlite'),
      parseServerId('srv_11111111111111111111111111111111'),
    )
    const device = database.createTrustedDevice('Mac').device
    const repositories = new RepositoryService(
      [{ id: 'root_test', label: 'Repos', path: root }],
      projectsRoot(root),
      async (args) => {
        if (args.includes('git@github-work:private/denied.git')) {
          throw Object.assign(new Error('git failed'), {
            code: 128,
            stderr: 'git@github-work: Permission denied (publickey).',
          })
        }
        return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
      },
    )
    const service = new ProjectService({
      database,
      repositories,
      registrar: { register: async () => undefined },
      cityName: 'factoru-test',
      cityPath: path.join(root, 'city'),
    })

    await expect(
      service.createProject(device, 'cmd_inaccessible', {
        name: 'Private platform',
        repositories: [
          { kind: 'remote', rootId: 'root_test', url: 'https://gitlab.com/open/api.git' },
          {
            kind: 'remote',
            rootId: 'root_test',
            url: 'git@github-work:private/denied.git',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'repository_authentication_required' })

    expect(database.listProjects()).toEqual([])
    expect(database.currentSequence()).toBe(0)
    expect(database.claimDueOutbox()).toEqual([])
    expect(fs.readdirSync(path.join(root, 'managed-projects'))).toEqual([])
    database.close()
  })

  it('revalidates failed remote access before requeueing repository setup', async () => {
    const root = fixtureDirectory()
    const database = new FactoruDatabase(
      path.join(root, 'factoru.sqlite'),
      parseServerId('srv_11111111111111111111111111111111'),
    )
    const device = database.createTrustedDevice('Mac').device
    let accessible = true
    const repositories = new RepositoryService(
      [{ id: 'root_test', label: 'Repos', path: root }],
      projectsRoot(root),
      async () => {
        if (!accessible) {
          throw Object.assign(new Error('git failed'), {
            code: 128,
            stderr: 'git@github.com: Permission denied (publickey).',
          })
        }
        return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' }
      },
    )
    const service = new ProjectService({
      database,
      repositories,
      registrar: { register: async () => undefined },
      cityName: 'factoru-test',
      cityPath: path.join(root, 'city'),
    })
    const project = await service.createProject(device, 'cmd_create_retry', {
      name: 'Retry project',
      repositories: [
        { kind: 'remote', rootId: 'root_test', url: 'git@github.com:owner/private.git' },
      ],
    })
    const [outbox] = database.claimDueOutbox()
    expect(outbox).toBeDefined()
    database.failProvisioning(
      outbox!.id,
      project.id,
      6,
      'repository_authentication_required',
      'Configure Git authentication.',
      outbox!.repositoryId,
    )

    accessible = false
    await expect(service.retrySetup(device, 'cmd_retry_blocked', project.id)).rejects.toMatchObject(
      { code: 'repository_authentication_required' },
    )
    expect(service.getProject(project.id).setupState).toBe('needs_attention')
    expect(database.claimDueOutbox()).toEqual([])

    accessible = true
    await expect(service.retrySetup(device, 'cmd_retry_ready', project.id)).resolves.toMatchObject({
      setupState: 'setting_up',
    })
    expect(database.claimDueOutbox()).toHaveLength(1)
    database.close()
  })
})
