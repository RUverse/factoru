import { z } from 'zod'
import { queueReconciliationSchema, taskMergeProposalSchema, taskSchema } from './milestone4.js'
import { executionRunSchema } from './milestone5.js'
import {
  artifactSchema,
  conversationContextSchema,
  messageContentPartSchema,
} from './milestone7.js'

export const CAPABILITY_WORKSPACES = 'workspaces-v1'
export const CAPABILITY_CONVERSATIONS = 'conversations-v1'
export const CAPABILITY_WORKER_TYPES = 'worker-types-v1'
export const CAPABILITY_PROJECT_BLUEPRINTS = 'project-blueprints-v1'
export const CAPABILITY_WORKFLOW_PRESETS = 'workflow-presets-v1'
export const CAPABILITY_MODEL_CATALOG = 'model-catalog-v1'

export const workerTypeKindSchema = z.enum(['project_manager', 'software_engineer'])
export const modelSlotSchema = z.enum(['chat', 'planning', 'design', 'implementation', 'review'])

export const workflowPresetIdSchema = z.enum(['standard-build', 'fast-patch'])
export const projectBlueprintIdSchema = z.enum(['standard-software-project', 'fast-patch'])
export const workflowSelectionSourceSchema = z.enum([
  'blueprint_default',
  'project_default',
  'pm',
  'user',
])

export const workflowPresetSchema = z.object({
  id: workflowPresetIdSchema,
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  formulaName: z.enum(['standard-build', 'software-delivery']),
  formulaVersion: z.string().min(1),
  launchMode: z.enum(['attached', 'standalone']),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  capabilities: z.object({
    maxImplementationUnits: z.number().int().min(1).max(20),
    maxVerificationAttempts: z.number().int().min(1).max(2),
    maxCorrectionAttempts: z.number().int().min(1).max(6),
    allowPush: z.literal(false),
    allowOpenPr: z.literal(false),
    interactionMode: z.literal('autonomous'),
    drainPolicy: z.literal('same-session'),
  }),
})

export const projectBlueprintSchema = z.object({
  id: projectBlueprintIdSchema,
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  recommended: z.boolean(),
  teamRoleKinds: z.array(workerTypeKindSchema),
  allowedWorkflowPresetIds: z.array(workflowPresetIdSchema).min(1),
  defaultWorkflowPresetId: workflowPresetIdSchema,
})

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

export const modelCatalogSchema = z.object({
  status: z.enum(['ready', 'unavailable']).default('unavailable'),
  providers: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(160),
        defaultModelId: z.string().trim().min(1).max(160).nullable(),
        models: z.array(
          z.object({
            id: z.string().trim().min(1).max(160),
            name: z.string().trim().min(1).max(240),
          }),
        ),
      }),
    )
    .default([]),
  message: z.string().trim().min(1).max(500).nullable().default(null),
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
  blueprintId: projectBlueprintIdSchema.default('standard-software-project'),
  blueprintVersion: z.number().int().positive().default(1),
  defaultWorkflowPresetId: workflowPresetIdSchema.default('standard-build'),
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
  text: z.string(),
  authorDisplayName: z.string(),
  inReplyToMessageId: z.string().nullable(),
  deliveryState: z.enum(['pending', 'delivered', 'failed']),
  tokenUsage: z
    .object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() })
    .nullable(),
  toolActivity: z.array(toolActivitySchema),
  turnId: z.string().nullable().default(null),
  state: z
    .enum(['pending', 'streaming', 'completed', 'cancelling', 'cancelled', 'failed'])
    .default('completed'),
  contentVersion: z.number().int().positive().default(1),
  contextRevision: z.number().int().positive().default(1),
  parts: z.array(messageContentPartSchema).default([]),
  createdAt: z.iso.datetime(),
})

export const conversationSchema = z.object({
  id: z.string(),
  status: z.enum(['connecting', 'ready', 'offline', 'needs_attention']),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  messages: z.array(conversationMessageSchema),
  transcriptCursor: z.number().int().nonnegative(),
  streamCursor: z.number().int().nonnegative().default(0),
  hasMoreHistory: z.boolean().default(false),
  activeTurnId: z.string().nullable().default(null),
  contextRevision: z.number().int().positive().default(1),
  contextStartedAt: z.iso.datetime().nullable().default(null),
  canResetContext: z.boolean().default(false),
  contexts: z.array(conversationContextSchema).default([]),
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

export const workspaceSchema = z
  .object({
    projectId: z.string(),
    factory: factorySettingsSchema,
    blueprint: projectBlueprintSchema.default({
      id: 'standard-software-project',
      version: 1,
      name: 'Standard Software Project',
      description: 'Full lifecycle delivery by default, with Fast Patch available.',
      recommended: true,
      teamRoleKinds: ['project_manager', 'software_engineer'],
      allowedWorkflowPresetIds: ['standard-build', 'fast-patch'],
      defaultWorkflowPresetId: 'standard-build',
    }),
    blueprintCatalog: z.array(projectBlueprintSchema).default([]),
    workflowPresets: z.array(workflowPresetSchema).default([]),
    modelCatalog: modelCatalogSchema.default({
      status: 'unavailable',
      providers: [],
      message: 'Model catalog is not available from this factory.',
    }),
    team: z.array(workerTypeSchema).default([]),
    // One-version read-only compatibility alias for clients built against Worker Types.
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
  .transform((workspace) => ({
    ...workspace,
    team: workspace.team.length > 0 ? workspace.team : workspace.workerTypes,
  }))

export const workspaceParamsSchema = z.object({ projectId: z.string().min(1) })
export const conversationSendParamsSchema = workspaceParamsSchema
  .extend({
    text: z.string().trim().max(32_000).default(''),
    artifactIds: z.array(artifactSchema.shape.id).max(4).default([]),
  })
  .refine((value) => value.text.length > 0 || value.artifactIds.length > 0, {
    message: 'A conversation message requires text or at least one image',
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
export const projectWorkflowDefaultUpdateParamsSchema = workspaceParamsSchema.extend({
  workflowPresetId: workflowPresetIdSchema,
})

export type Workspace = z.infer<typeof workspaceSchema>
export type WorkerType = z.infer<typeof workerTypeSchema>
export type WorkflowPreset = z.infer<typeof workflowPresetSchema>
export type ProjectBlueprint = z.infer<typeof projectBlueprintSchema>
export type ModelCatalog = z.infer<typeof modelCatalogSchema>
export type Conversation = z.infer<typeof conversationSchema>
export type ConversationMessage = z.infer<typeof conversationMessageSchema>
export type MemoryEntry = z.infer<typeof memoryEntrySchema>
export type PlannerProbe = z.infer<typeof plannerProbeSchema>
