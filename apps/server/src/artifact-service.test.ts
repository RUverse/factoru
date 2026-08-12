import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FactoruDatabase } from '@factoru/database'
import { parseServerId } from '@factoru/domain'
import { ArtifactService, inspectImage } from './artifact-service.js'

const directories: string[] = []

function png(width = 2, height = 3): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-artifacts-'))
  directories.push(directory)
  const db = new FactoruDatabase(
    path.join(directory, 'factoru.sqlite'),
    parseServerId('srv_11111111111111111111111111111111'),
    { now: () => new Date('2026-08-12T10:00:00.000Z') },
  )
  db.createPairingCode('ABCD-EFGH-JKMN', new Date('2026-08-12T11:00:00.000Z'))
  const device = db.exchangePairingCode('ABCD-EFGH-JKMN', 'Owner')!.device
  db.createProject({
    commandId: 'cmd_create',
    deviceId: device.id,
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
  const conversation = db.product.getConversation('prj_11111111111111111111111111111111')!
  return { db, directory, conversation, device }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('ArtifactService', () => {
  it('validates signatures and dimensions instead of trusting the MIME header', () => {
    expect(inspectImage(png(), 'image/png')).toMatchObject({ width: 2, height: 3 })
    expect(() => inspectImage(Buffer.from('not a png'), 'image/png')).toThrow(
      'file contents do not match',
    )
    expect(() => inspectImage(png(8193, 1), 'image/png')).toThrow('must not exceed')
  })

  it('rejects a symbolic link as the artifact storage root', () => {
    const { db, directory } = fixture()
    const target = path.join(directory, 'artifact-target')
    const link = path.join(directory, 'artifact-link')
    fs.mkdirSync(target)
    fs.symlinkSync(target, link)

    expect(() => new ArtifactService(db, link)).toThrow('artifact_storage_root_must_not_be_a_link')
    db.close()
  })

  it('keeps bytes outside SQLite and enforces scoped and grant-based reads', () => {
    const { db, directory, conversation, device } = fixture()
    const service = new ArtifactService(db, path.join(directory, 'artifacts'))
    const artifact = service.upload({
      projectId: conversation.projectId,
      conversationId: conversation.id,
      deviceId: device.id,
      fileName: '../screenshot.png',
      mimeType: 'image/png',
      provenance: 'drop',
      bytes: png(),
    })

    expect(artifact.fileName).toBe('screenshot.png')
    expect(service.readScoped(conversation.projectId, conversation.id, artifact.id).bytes).toEqual(
      png(),
    )
    const grantUrl = new URL(service.attachmentUrl(artifact.id, 'http://127.0.0.1:8787'))
    expect(
      service.readWithGrant(artifact.id, grantUrl.searchParams.get('token')!).artifact.id,
    ).toBe(artifact.id)
    expect(() => service.readWithGrant(artifact.id, 'wrong-token')).toThrow('invalid or expired')
    expect(db.connection.prepare('SELECT COUNT(*) AS n FROM conversation_artifacts').get()).toEqual(
      { n: 1 },
    )
    expect(
      db.connection.prepare('SELECT COUNT(*) AS n FROM conversation_content_parts').get(),
    ).toEqual({ n: 0 })
    db.close()
  })
})
