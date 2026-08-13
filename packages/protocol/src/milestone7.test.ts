import { describe, expect, it } from 'vitest'
import { conversationSendParamsSchema } from './milestone3.js'
import {
  artifactSchema,
  conversationHistoryPageSchema,
  conversationHistoryParamsSchema,
  conversationResetContextParamsSchema,
  scopedStreamEventSchema,
  streamSubscribeParamsSchema,
} from './milestone7.js'

describe('Milestone 7 protocol', () => {
  it('supports text-only, mixed, and image-only turns but rejects an empty turn', () => {
    expect(conversationSendParamsSchema.safeParse({ projectId: 'p', text: 'hello' }).success).toBe(
      true,
    )
    expect(
      conversationSendParamsSchema.safeParse({
        projectId: 'p',
        text: '',
        artifactIds: ['art_0123456789abcdef0123456789abcdef'],
      }).success,
    ).toBe(true)
    expect(conversationSendParamsSchema.safeParse({ projectId: 'p', text: '' }).success).toBe(false)
  })

  it('keeps artifact identifiers opaque and validates browser-safe metadata', () => {
    expect(
      artifactSchema.parse({
        id: 'art_0123456789abcdef0123456789abcdef',
        projectId: 'p',
        conversationId: 'c',
        fileName: 'screen.png',
        mimeType: 'image/png',
        sizeBytes: 24,
        width: 2,
        height: 3,
        contentHash: 'a'.repeat(64),
        provenance: 'paste',
        status: 'ready',
        createdAt: '2026-08-12T10:00:00.000Z',
        retentionExpiresAt: '2026-09-12T10:00:00.000Z',
      }),
    ).not.toHaveProperty('storageKey')
  })

  it('models explicit snapshot and live markers around a scoped replay cursor', () => {
    const subscription = streamSubscribeParamsSchema.parse({
      subscriptionId: 'conversation',
      resource: { kind: 'conversation', projectId: 'p', conversationId: 'c' },
      afterCursor: 12,
    })
    expect(
      scopedStreamEventSchema.parse({
        type: 'stream.live',
        subscriptionId: subscription.subscriptionId,
        resource: subscription.resource,
        cursor: 15,
      }),
    ).toMatchObject({ type: 'stream.live', cursor: 15 })
  })

  it('scopes context reset to one project conversation', () => {
    expect(
      conversationResetContextParamsSchema.parse({ projectId: 'p', conversationId: 'c' }),
    ).toEqual({ projectId: 'p', conversationId: 'c' })
    expect(conversationResetContextParamsSchema.safeParse({ projectId: 'p' }).success).toBe(false)
  })

  it('pages one durable chat context at a time', () => {
    expect(
      conversationHistoryParamsSchema.parse({
        projectId: 'p',
        conversationId: 'c',
        contextRevision: 2,
      }),
    ).toMatchObject({ contextRevision: 2, limit: 50 })
    expect(
      conversationHistoryPageSchema.parse({
        conversationId: 'c',
        contextRevision: 2,
        messages: [],
        nextBefore: null,
        hasMore: false,
      }),
    ).toMatchObject({ contextRevision: 2 })
  })
})
