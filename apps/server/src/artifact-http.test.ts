import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FactoruDatabase } from '@factoru/database'
import { parseServerId } from '@factoru/domain'
import { buildServer } from './app.js'
import { ArtifactService } from './artifact-service.js'
import { ProjectService } from './project-service.js'
import { RepositoryService } from './repositories.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

function png(): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(2, 16)
  bytes.writeUInt32BE(3, 20)
  return bytes
}

describe('artifact HTTP boundary', () => {
  it('authenticates and scopes binary upload, download, and deletion', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-artifact-http-'))
    directories.push(directory)
    const serverId = parseServerId('srv_11111111111111111111111111111111')
    const database = new FactoruDatabase(path.join(directory, 'factoru.sqlite'), serverId)
    database.createPairingCode('ABCD-EFGH-JKMN', new Date(Date.now() + 60_000))
    const paired = database.exchangePairingCode('ABCD-EFGH-JKMN', 'Owner')!
    const project = database.createProject({
      commandId: 'cmd_create',
      deviceId: paired.device.id,
      requestHash: 'hash',
      projectId: 'prj_11111111111111111111111111111111',
      name: 'Factoru',
      repositoryRootId: 'root_main',
      repositoryRelativePath: 'factoru',
      repositoryRealPath: '/srv/repos/factoru',
      defaultBranch: 'dev',
      cityName: 'factoru-city',
      rigName: 'factoru-rig',
      beadPrefix: 'fact',
    })
    const conversation = database.product.getConversation(project.id)!
    const projects = new ProjectService({
      database,
      repositories: new RepositoryService([], {
        id: 'root_projects',
        label: 'Projects',
        path: path.join(directory, 'projects'),
      }),
      registrar: { register: async () => undefined },
      cityName: 'factoru-city',
      cityPath: path.join(directory, 'city'),
    })
    const app = buildServer({
      serverId,
      database,
      projectService: projects,
      artifactService: new ArtifactService(database, path.join(directory, 'artifacts')),
      logLevel: 'silent',
    })
    const collection = `/api/v1/projects/${project.id}/conversations/${conversation.id}/artifacts`
    expect(
      (
        await app.inject({
          method: 'POST',
          url: collection,
          payload: png(),
          headers: {
            'content-type': 'image/png',
            'x-file-name': 'screen.png',
            'x-artifact-provenance': 'picker',
          },
        })
      ).statusCode,
    ).toBe(401)
    const uploaded = await app.inject({
      method: 'POST',
      url: collection,
      payload: png(),
      headers: {
        authorization: `Bearer ${paired.token}`,
        'content-type': 'image/png',
        'x-file-name': 'screen.png',
        'x-artifact-provenance': 'picker',
      },
    })
    expect(uploaded.statusCode).toBe(201)
    const artifactId = uploaded.json().id as string
    expect(uploaded.json()).not.toHaveProperty('storageKey')
    const fetched = await app.inject({
      method: 'GET',
      url: `${collection}/${artifactId}`,
      headers: { authorization: `Bearer ${paired.token}` },
    })
    expect(fetched.statusCode).toBe(200)
    expect(fetched.headers['x-content-type-options']).toBe('nosniff')
    expect(fetched.rawPayload).toEqual(png())
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/projects/${project.id}/conversations/conv_wrong/artifacts/${artifactId}`,
          headers: { authorization: `Bearer ${paired.token}` },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `${collection}/${artifactId}`,
          headers: { authorization: `Bearer ${paired.token}` },
        })
      ).statusCode,
    ).toBe(204)
    await app.close()
    database.close()
  })
})
