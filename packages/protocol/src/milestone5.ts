import { z } from 'zod'

export const CAPABILITY_SOFTWARE_DELIVERY = 'software-delivery-v1'

export const executionRunStatusSchema = z.enum([
  'pending',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
])
export const executionStageSchema = z.enum([
  'admission',
  'capsule',
  'implementation',
  'checks',
  'review',
  'integration',
  'needs_you',
  'terminal',
])
export const executionStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum([
    'pending',
    'running',
    'blocked',
    'cancelling',
    'completed',
    'failed',
    'cancelled',
    'skipped',
    'unknown',
  ]),
})
export const executionUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
})
export const executionReviewPackageSchema = z.object({
  request: z.string(),
  plan: z.string(),
  diff: z.string(),
  commits: z.array(z.string()),
  checks: z.object({ status: z.enum(['passed', 'failed']), output: z.string() }),
  internalReview: z.string(),
  unresolvedRisks: z.array(z.string()),
  usage: executionUsageSchema,
  capsulePath: z.string(),
  branchName: z.string(),
})
export const executionRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  formulaName: z.string(),
  formulaVersion: z.string().nullable(),
  formulaHash: z.string().nullable(),
  status: executionRunStatusSchema,
  stage: executionStageSchema,
  capsule: z
    .object({ id: z.string(), path: z.string(), branchName: z.string(), baseBranch: z.string() })
    .nullable(),
  steps: z.array(executionStepSchema),
  logs: z.array(z.string()),
  usage: executionUsageSchema,
  reviewPackage: executionReviewPackageSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
})

export const executionRunParamsSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().min(1),
})
export const executionRequestChangesParamsSchema = executionRunParamsSchema.extend({
  feedback: z.string().trim().min(1).max(8_000),
})
export const executionApproveParamsSchema = executionRunParamsSchema.extend({
  summary: z.string().trim().min(1).max(4_000).default('Accepted after user review.'),
})

export type ExecutionRun = z.infer<typeof executionRunSchema>
export type ExecutionUsage = z.infer<typeof executionUsageSchema>
export type ExecutionReviewPackage = z.infer<typeof executionReviewPackageSchema>
