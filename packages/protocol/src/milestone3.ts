import { z } from 'zod'
import { queueReconciliationSchema, taskMergeProposalSchema, taskSchema } from './milestone4.js'
import { executionRunSchema } from './milestone5.js'

export const CAPABILITY_WORKSPACES = 'workspaces-v1'
export const CAPABILITY_CONVERSATIONS = 'conversations-v1'
export const CAPABILITY_WORKER_TYPES = 'worker-types-v1'

export const workerTypeKindSchema = z.enum(['project_manager', 'software_engineer'])
export const modelSlotSchema = z.enum(['chat', 'planning', 'implementation', 'review'])

export const modelBindingSchema = z
  .object({
    slot: modelSlotSchema,
    provider: z.string().trim().min(1).max(80).nullable(),
    model: z.string().trim().min(1).max(160).nullable(),
    version: z.number().int().positive(),
  })
  .refine((value) => (value.provider === null) === (value.model === null), {
    message: 'provider and model must either both be set or both be null',
  })

export const workerTypeSchema = z.object({
  kind: workerTypeKindSchema,
  displayName: z.string().min(1),
  promptOverride: z.string().nullable(),
  defaultFormula: z.string().nullable(),
  capacity: z.literal(1),
  allowedTools: z.array(z.string()),
  memoryPolicy: z.literal('provenance_required'),
  version: z.number().int().positive(),
  modelBindings: z.array(modelBindingSchema),
  updatedAt: z.iso.datetime(),
})

export const factorySettingsSchema = z.object({
  templateId: z.literal('software-project'),
  templateVersion: z.number().int().positive(),
  maxParallelImplementationWorkers: z.literal(1),
  executionWipLimit: z.literal(1).default(1),
  queueRevision: z.number().int().nonnegative().default(0),
})

export const toolActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
  summary: z.string().optional(),
})

export const conversationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1),
  authorDisplayName: z.string(),
  inReplyToMessageId: z.string().nullable(),
  deliveryState: z.enum(['pending', 'delivered', 'failed']),
  tokenUsage: z
    .object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() })
    .nullable(),
  toolActivity: z.array(toolActivitySchema),
  createdAt: z.iso.datetime(),
})

export const conversationSchema = z.object({
  id: z.string(),
  status: z.enum(['connecting', 'ready', 'offline', 'needs_attention']),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  messages: z.array(conversationMessageSchema),
  transcriptCursor: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
})

export const memoryEntrySchema = z.object({
  id: z.string(),
  scope: z.enum(['project', 'worker_type']),
  workerTypeKind: workerTypeKindSchema.nullable(),
  content: z.string().min(1),
  provenance: z.object({
    kind: z.enum(['user_message', 'user_edit', 'task_evidence', 'system_import']),
    ref: z.string().min(1),
  }),
  version: z.number().int().positive(),
  supersedesId: z.string().nullable(),
  createdAt: z.iso.datetime(),
})

export const plannerProbeSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'running', 'cancelling', 'completed', 'failed', 'cancelled']),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  requestedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})

export const workspaceSchema = z.object({
  projectId: z.string(),
  factory: factorySettingsSchema,
  workerTypes: z.array(workerTypeSchema),
  conversation: conversationSchema,
  memory: z.array(memoryEntrySchema),
  plannerProbe: plannerProbeSchema.nullable(),
  tasks: z.array(taskSchema).default([]),
  recentTaskResolutions: z.array(taskSchema).default([]),
  queueReconciliation: queueReconciliationSchema.nullable().default(null),
  taskMergeProposals: z.array(taskMergeProposalSchema).default([]),
  taskRuns: z.array(executionRunSchema).default([]),
})

export const workspaceParamsSchema = z.object({ projectId: z.string().min(1) })
export const conversationSendParamsSchema = workspaceParamsSchema.extend({
  text: z.string().trim().min(1).max(32_000),
})
export const modelBindingUpdateParamsSchema = workspaceParamsSchema
  .extend({
    workerTypeKind: workerTypeKindSchema,
    slot: modelSlotSchema,
    provider: z.string().trim().min(1).max(80).nullable(),
    model: z.string().trim().min(1).max(160).nullable(),
  })
  .refine((value) => (value.provider === null) === (value.model === null), {
    message: 'provider and model must either both be set or both be null',
  })
export const memoryAddParamsSchema = workspaceParamsSchema.extend({
  scope: z.enum(['project', 'worker_type']),
  workerTypeKind: workerTypeKindSchema.optional(),
  content: z.string().trim().min(1).max(16_000),
  provenanceRef: z.string().trim().min(1).max(500),
  supersedesId: z.string().optional(),
})
export const plannerCancelParamsSchema = workspaceParamsSchema.extend({
  plannerProbeId: z.string().min(1),
})

export type Workspace = z.infer<typeof workspaceSchema>
export type WorkerType = z.infer<typeof workerTypeSchema>
export type Conversation = z.infer<typeof conversationSchema>
export type ConversationMessage = z.infer<typeof conversationMessageSchema>
export type MemoryEntry = z.infer<typeof memoryEntrySchema>
export type PlannerProbe = z.infer<typeof plannerProbeSchema>
