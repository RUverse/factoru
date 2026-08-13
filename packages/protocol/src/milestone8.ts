import { z } from 'zod'
import { executionRunSchema, executionUsageSchema } from './milestone5.js'

const safeIdentifierSchema = z.string().trim().min(1).max(160)
const noControlCharacters = (value: string) =>
  !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return (
      (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) ||
      codePoint === 127
    )
  })
const boundedTextSchema = z
  .string()
  .max(4_096)
  .refine(noControlCharacters, 'Control characters are not allowed')

export const taskEvidenceSchema = z.object({
  id: safeIdentifierSchema,
  taskId: safeIdentifierSchema,
  kind: z.enum(['request', 'scope', 'decision', 'check', 'review', 'artifact']),
  summary: boundedTextSchema,
  provenance: z.object({
    kind: z.enum(['user_message', 'pm_judgment', 'task_run', 'agent_report', 'system']),
    ref: safeIdentifierSchema,
  }),
  createdAt: z.iso.datetime(),
})

const taskResourceIntentInputSchema = z
  .object({
    kind: z.enum(['repository_path', 'service', 'database', 'exclusive_resource']),
    name: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine(noControlCharacters, 'Control characters are not allowed'),
    access: z.enum(['read', 'write', 'exclusive']),
  })
  .superRefine((intent, context) => {
    if (
      intent.kind === 'repository_path' &&
      (intent.name.startsWith('/') ||
        intent.name.startsWith('~') ||
        intent.name.split('/').includes('..'))
    )
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Repository resources must be relative and cannot traverse',
      })
    if (intent.kind === 'exclusive_resource' && intent.access !== 'exclusive') {
      context.addIssue({
        code: 'custom',
        path: ['access'],
        message: 'Named exclusive resources require exclusive access',
      })
    }
  })
export const taskResourceIntentSchema = z.intersection(
  z.object({ id: safeIdentifierSchema, taskId: safeIdentifierSchema, createdAt: z.iso.datetime() }),
  taskResourceIntentInputSchema,
)

export const taskSupersessionSchema = z.object({
  parentTaskId: safeIdentifierSchema,
  childTaskIds: z.array(safeIdentifierSchema).min(1).max(8),
  kind: z.enum(['split', 'merge']),
  reason: z.string().trim().min(1).max(4_096),
  createdAt: z.iso.datetime(),
})

export const memoryProposalSchema = z.object({
  id: safeIdentifierSchema,
  projectId: safeIdentifierSchema,
  scope: z.enum(['project', 'worker_type']),
  workerTypeKind: z.enum(['project_manager', 'software_engineer']).nullable(),
  content: z
    .string()
    .trim()
    .min(1)
    .max(4_096)
    .refine(noControlCharacters, 'Control characters are not allowed'),
  provenance: z.object({ kind: z.string().min(1).max(80), ref: safeIdentifierSchema }),
  status: z.enum(['pending', 'accepted', 'rejected']),
  proposedBy: safeIdentifierSchema,
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
})

export const runProjectionStateSchema = z.object({
  completeness: z.enum(['complete', 'partial', 'stale']),
  cursor: z.number().int().nonnegative(),
  lastCompleteCursor: z.number().int().nonnegative(),
  reconciledAt: z.iso.datetime().nullable(),
  reason: z.string().max(1_000).nullable(),
})

export const runStageProjectionSchema = z.object({
  id: safeIdentifierSchema,
  title: z.string().min(1).max(240),
  ordinal: z.number().int().nonnegative(),
  status: z.enum([
    'pending',
    'running',
    'blocked',
    'completed',
    'failed',
    'cancelled',
    'skipped',
    'unknown',
  ]),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
})

export const runDependencyEdgeSchema = z.object({
  from: safeIdentifierSchema,
  to: safeIdentifierSchema,
})

export const convoyUnitSchema = z.object({
  id: safeIdentifierSchema,
  title: z.string().min(1).max(300),
  ordinal: z.number().int().nonnegative(),
  status: runStageProjectionSchema.shape.status,
  dependencyIds: z.array(safeIdentifierSchema).max(20),
  sessionId: safeIdentifierSchema.nullable(),
  attempt: z.number().int().nonnegative(),
})

export const runTranscriptExcerptSchema = z.object({
  sequence: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  text: boundedTextSchema,
  redacted: z.boolean(),
  createdAt: z.iso.datetime(),
})

export const runSessionProjectionSchema = z.object({
  id: safeIdentifierSchema,
  purpose: z.enum([
    'implementation',
    'correctness_testing',
    'security_reliability',
    'maintainability_architecture',
    'review_synthesis',
    'correction',
  ]),
  status: z.enum(['pending', 'running', 'idle', 'completed', 'failed', 'cancelled', 'unknown']),
  excerpts: z.array(runTranscriptExcerptSchema).max(40),
})

export const runArtifactSchema = z.object({
  id: safeIdentifierSchema,
  kind: z.enum(['formula', 'decomposition', 'handoff', 'check', 'review', 'synthesis', 'other']),
  label: z.string().min(1).max(240),
  mediaType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative(),
  available: z.boolean(),
  createdAt: z.iso.datetime(),
})

export const specialistLaneSchema = z.enum([
  'correctness_testing',
  'security_reliability',
  'maintainability_architecture',
])
export const specialistReportSchema = z.object({
  id: safeIdentifierSchema,
  lane: specialistLaneSchema,
  status: z.enum(['pending', 'running', 'approved', 'changes_requested', 'failed']),
  summary: boundedTextSchema,
  findings: z.array(z.string().max(1_000)).max(50),
  artifactId: safeIdentifierSchema.nullable(),
})

export const reviewSynthesisSchema = z.object({
  status: z.enum(['pending', 'running', 'approved', 'changes_requested', 'failed']),
  summary: boundedTextSchema,
  requestedCorrections: z.array(z.string().max(1_000)).max(50),
  artifactId: safeIdentifierSchema.nullable(),
})

export const runAttemptBudgetSchema = z.object({
  verification: z.object({ used: z.number().int().nonnegative(), limit: z.literal(2) }),
  correction: z.object({ used: z.number().int().nonnegative(), limit: z.literal(6) }),
  transient: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().positive() }),
})

export const runDetailSchema = z.object({
  summary: executionRunSchema,
  projection: runProjectionStateSchema,
  formula: z.object({
    name: z.string().min(1),
    version: z.string().nullable(),
    hash: z.string().nullable(),
    stages: z.array(runStageProjectionSchema),
    edges: z.array(runDependencyEdgeSchema),
  }),
  convoy: z.object({
    id: safeIdentifierSchema.nullable(),
    drainPolicy: z.literal('same-session'),
    singleLane: z.literal(true),
    units: z.array(convoyUnitSchema).max(20),
  }),
  sessions: z.array(runSessionProjectionSchema).max(32),
  artifacts: z.array(runArtifactSchema).max(100),
  specialistReports: z.array(specialistReportSchema).max(3),
  synthesis: reviewSynthesisSchema.nullable(),
  budgets: runAttemptBudgetSchema,
  usage: executionUsageSchema,
  cancellation: z.object({
    requestedAt: z.iso.datetime().nullable(),
    confirmedAt: z.iso.datetime().nullable(),
  }),
  recovery: z.object({
    state: z.enum(['current', 'replaying', 'reconciled', 'needs_attention']),
    message: z.string().max(1_000).nullable(),
  }),
})

export const taskSplitParamsSchema = z.object({
  projectId: safeIdentifierSchema,
  taskId: safeIdentifierSchema,
  reason: z.string().trim().min(1).max(4_096),
  children: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(20_000).default(''),
        resourceIntents: z.array(taskResourceIntentInputSchema).max(32).default([]),
      }),
    )
    .min(2)
    .max(8),
})

export const taskEvidenceParamsSchema = z.object({
  projectId: safeIdentifierSchema,
  taskId: safeIdentifierSchema,
  kind: taskEvidenceSchema.shape.kind,
  summary: z.string().trim().min(1).max(4_096),
  provenance: taskEvidenceSchema.shape.provenance,
})

export const taskResourceIntentsParamsSchema = z.object({
  projectId: safeIdentifierSchema,
  taskId: safeIdentifierSchema,
  intents: z.array(taskResourceIntentInputSchema).max(32),
})

export const memorySearchParamsSchema = z.object({
  projectId: safeIdentifierSchema,
  query: z.string().trim().max(1_000).default(''),
  workerTypeKind: z.enum(['project_manager', 'software_engineer']).optional(),
  limit: z.number().int().min(1).max(8).default(8),
})

export const memoryProposeUpdateParamsSchema = z.object({
  projectId: safeIdentifierSchema,
  scope: z.enum(['project', 'worker_type']),
  workerTypeKind: z.enum(['project_manager', 'software_engineer']).nullable().default(null),
  content: z.string().trim().min(1).max(4_096),
  provenance: memoryProposalSchema.shape.provenance,
})

export const memoryDecideProposalParamsSchema = z.object({
  projectId: safeIdentifierSchema,
  proposalId: safeIdentifierSchema,
  decision: z.enum(['accept', 'reject']),
})

export const runDetailParamsSchema = z.object({
  projectId: safeIdentifierSchema,
  runId: safeIdentifierSchema,
})
export const runArtifactReadParamsSchema = runDetailParamsSchema.extend({
  artifactId: safeIdentifierSchema,
})

export type RunDetail = z.infer<typeof runDetailSchema>
export type TaskEvidence = z.infer<typeof taskEvidenceSchema>
export type TaskResourceIntent = z.infer<typeof taskResourceIntentSchema>
export type MemoryProposal = z.infer<typeof memoryProposalSchema>
