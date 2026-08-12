import { z } from 'zod'
import { executionRunSchema } from './milestone5.js'
import { projectLiveEventSchema, projectSchema } from './milestone2.js'

export const CAPABILITY_SCOPED_STREAMS = 'scoped-streams-v1'
export const CAPABILITY_RICH_CONVERSATIONS = 'rich-conversations-v1'
export const CAPABILITY_IMAGE_ARTIFACTS = 'image-artifacts-v1'
export const CAPABILITY_CONVERSATION_CONTEXT_RESET = 'conversation-context-reset-v1'

export const ARTIFACT_UPLOAD_PATH =
  '/api/v1/projects/:projectId/conversations/:conversationId/artifacts'
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 8_192
export const MAX_MESSAGE_IMAGES = 4

export const imageMimeTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export const artifactSchema = z.object({
  id: z.string().regex(/^art_[0-9a-f]{32}$/),
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: imageMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
  width: z.number().int().positive().max(MAX_IMAGE_DIMENSION),
  height: z.number().int().positive().max(MAX_IMAGE_DIMENSION),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  provenance: z.enum(['picker', 'paste', 'drop']),
  status: z.enum(['ready', 'cancelled', 'deleted']),
  createdAt: z.iso.datetime(),
  retentionExpiresAt: z.iso.datetime(),
})

export const textContentPartSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  type: z.literal('text'),
  text: z.string(),
})

export const imageContentPartSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  type: z.literal('image'),
  artifact: artifactSchema,
  alt: z.string().max(500).default(''),
})

export const toolOperationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['running', 'completed', 'failed']),
  summary: z.string().max(4_000).nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})

export const toolContentPartSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  type: z.literal('tool'),
  tool: toolOperationSchema,
})

export const messageContentPartSchema = z.discriminatedUnion('type', [
  textContentPartSchema,
  imageContentPartSchema,
  toolContentPartSchema,
])

export const conversationTurnSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  userMessageId: z.string().min(1),
  assistantMessageId: z.string().nullable(),
  state: z.enum(['pending', 'streaming', 'completed', 'cancelling', 'cancelled', 'failed']),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
})

export const conversationHistoryPageSchema = z.object({
  conversationId: z.string().min(1),
  contextRevision: z.number().int().positive(),
  messages: z.array(z.unknown()),
  nextBefore: z.string().nullable(),
  hasMore: z.boolean(),
})

export const streamResourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shell') }),
  z.object({ kind: z.literal('workspace'), projectId: z.string().min(1) }),
  z.object({
    kind: z.literal('conversation'),
    projectId: z.string().min(1),
    conversationId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('run'),
    projectId: z.string().min(1),
    runId: z.string().min(1),
  }),
])

export const streamSubscribeParamsSchema = z.object({
  subscriptionId: z.string().min(1).max(120),
  resource: streamResourceSchema,
  afterCursor: z.number().int().nonnegative().default(0),
})
export const streamUnsubscribeParamsSchema = z.object({
  subscriptionId: z.string().min(1).max(120),
})

const streamEventBase = z.object({
  subscriptionId: z.string().min(1),
  resource: streamResourceSchema,
  cursor: z.number().int().nonnegative(),
})

export const streamSnapshotEventSchema = streamEventBase.extend({
  type: z.literal('stream.snapshot'),
  resynchronized: z.boolean(),
  reason: z.enum(['initial', 'cursor_gap', 'reconnect']).default('initial'),
  data: z.unknown(),
})
export const streamDeltaEventSchema = streamEventBase.extend({
  type: z.literal('stream.delta'),
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  data: z.unknown(),
  occurredAt: z.iso.datetime(),
})
export const streamLiveEventSchema = streamEventBase.extend({
  type: z.literal('stream.live'),
})
export const streamHeartbeatEventSchema = z.object({
  type: z.literal('stream.heartbeat'),
  serverTime: z.iso.datetime(),
})
export const scopedStreamEventSchema = z.discriminatedUnion('type', [
  streamSnapshotEventSchema,
  streamDeltaEventSchema,
  streamLiveEventSchema,
  streamHeartbeatEventSchema,
])
export const liveEventSchema = z.union([projectLiveEventSchema, scopedStreamEventSchema])

export const conversationHistoryParamsSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  before: z.string().min(1).optional(),
  contextRevision: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(50),
})

export const conversationContextSchema = z.object({
  revision: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  messageCount: z.number().int().nonnegative(),
  preview: z.string().max(240).nullable(),
  current: z.boolean(),
})

export const conversationCancelParamsSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
})

export const conversationRetryParamsSchema = conversationCancelParamsSchema
  .omit({ turnId: true })
  .extend({ messageId: z.string().min(1) })

export const conversationResetContextParamsSchema = conversationCancelParamsSchema.omit({
  turnId: true,
})

export const shellStreamSnapshotSchema = z.object({ projects: z.array(projectSchema) })
export const runStreamSnapshotSchema = z.object({ run: executionRunSchema })

export type Artifact = z.infer<typeof artifactSchema>
export type MessageContentPart = z.infer<typeof messageContentPartSchema>
export type ConversationTurn = z.infer<typeof conversationTurnSchema>
export type ConversationContext = z.infer<typeof conversationContextSchema>
export type ConversationHistoryPage = z.infer<typeof conversationHistoryPageSchema>
export type StreamResource = z.infer<typeof streamResourceSchema>
export type ScopedStreamEvent = z.infer<typeof scopedStreamEventSchema>
