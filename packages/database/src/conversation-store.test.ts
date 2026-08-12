import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseServerId } from '@factoru/domain'
import { FactoruDatabase } from './database.js'

const directories: string[] = []

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-conversation-store-'))
  directories.push(directory)
  const db = new FactoruDatabase(
    path.join(directory, 'factoru.sqlite'),
    parseServerId('srv_11111111111111111111111111111111'),
    { now: () => new Date('2026-08-12T10:00:00.000Z') },
  )
  db.createPairingCode('ABCD-EFGH-JKMN', new Date('2026-08-12T11:00:00.000Z'))
  const device = db.exchangePairingCode('ABCD-EFGH-JKMN', 'Owner')!.device
  const project = db.createProject({
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
  return { db, device, conversation: db.product.getConversation(project.id)! }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('ConversationStore', () => {
  it('persists content parts and advances a monotonic stream cursor', () => {
    const { db, device, conversation } = fixture()
    const artifact = db.conversations.createArtifact({
      projectId: conversation.projectId,
      conversationId: conversation.id,
      createdByDeviceId: device.id,
      fileName: 'screen.png',
      storageKey: '0123456789abcdef0123456789abcdef.bin',
      contentHash: 'a'.repeat(64),
      mimeType: 'image/png',
      sizeBytes: 24,
      width: 2,
      height: 3,
      provenance: 'paste',
      retentionExpiresAt: '2026-09-12T10:00:00.000Z',
    })
    const created = db.conversations.addUserTurn({
      conversationId: conversation.id,
      text: '',
      artifactIds: [artifact.id],
      authorDisplayName: 'Owner',
    })
    db.conversations.attachSession(created.turn.id, 'session-1')
    const partial = db.conversations.upsertAssistantProjection({
      turnId: created.turn.id,
      providerMessageId: 'assistant-1',
      text: 'Checking…',
      tools: [{ id: 'tool-1', name: 'factoru.read_task', status: 'running' }],
      tokenInput: 4,
      tokenOutput: 2,
    })
    const afterPartial = db.conversations.currentStreamCursor(conversation.id)
    db.conversations.upsertAssistantProjection({
      turnId: created.turn.id,
      providerMessageId: 'assistant-1',
      text: 'Checking…',
      tools: [{ id: 'tool-1', name: 'factoru.read_task', status: 'running' }],
      tokenInput: 4,
      tokenOutput: 2,
    })
    expect(db.conversations.currentStreamCursor(conversation.id)).toBe(afterPartial)
    const beforeFinal = db.conversations.currentStreamCursor(conversation.id)
    const final = db.conversations.completeAssistantTurn({
      turnId: created.turn.id,
      sequence: 2,
      providerMessageId: 'assistant-1',
      text: 'Checked.',
      authorDisplayName: 'Project Manager',
      createdAt: '2026-08-12T10:00:01.000Z',
      tokenInput: 4,
      tokenOutput: 3,
    })

    expect(created.message.parts[0]).toMatchObject({ kind: 'image' })
    expect(partial.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'tool' })]),
    )
    expect(final).toMatchObject({ text: 'Checked.', state: 'completed' })
    expect(db.conversations.currentStreamCursor(conversation.id)).toBeGreaterThan(beforeFinal)
    expect(
      db.conversations.streamEventsAfter(conversation.id, 0).map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        'turn.started',
        'assistant.started',
        'assistant.text_delta',
        'assistant.completed',
      ]),
    )
    db.close()
  })

  it('makes cancellation terminal so late projections cannot overwrite it', () => {
    const { db, conversation } = fixture()
    const created = db.conversations.addUserTurn({
      conversationId: conversation.id,
      text: 'Stop this.',
      artifactIds: [],
      authorDisplayName: 'Owner',
    })
    db.conversations.attachSession(created.turn.id, 'session-1')
    db.conversations.finishCancellation(created.turn.id)
    expect(db.product.claimConversationDeliveries()).toEqual([])
    expect(db.conversations.getMessage(created.message.id)?.state).toBe('cancelled')
    expect(() =>
      db.conversations.upsertAssistantProjection({
        turnId: created.turn.id,
        providerMessageId: 'late',
        text: 'Too late',
        tools: [],
      }),
    ).toThrow('conversation_turn_terminal')
    expect(db.conversations.getTurn(created.turn.id)?.state).toBe('cancelled')
    db.close()
  })
})
