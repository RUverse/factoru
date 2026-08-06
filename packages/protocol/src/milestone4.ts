import { z } from 'zod'

export const CAPABILITY_TASKS = 'tasks-v1'
export const CAPABILITY_QUEUE_RECONCILIATION = 'queue-reconciliation-v1'

export const taskStatusSchema = z.enum(['backlog', 'queue', 'in_progress', 'needs_you'])
export const queuePhaseSchema = z.enum([
  'awaiting_triage',
  'triaging',
  'ready',
  'waiting_dependency',
  'waiting_capacity',
])
export const taskResolutionSchema = z.enum(['accepted', 'rejected', 'cancelled', 'superseded'])
export const needsYouActionSchema = z.enum([
  'clarify',
  'approve',
  'review',
  'resolve_conflict',
  'recover_failure',
])

export const taskSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20_000),
    status: taskStatusSchema,
    queuePhase: queuePhaseSchema.nullable(),
    priority: z.number().int().min(0).max(100),
    queueOrder: z.number().int().nonnegative(),
    workerTypeKind: z.enum(['project_manager', 'software_engineer']).nullable(),
    formulaName: z.string().nullable(),
    needsYouAction: needsYouActionSchema.nullable(),
    needsYouMessage: z.string().nullable(),
    resolution: taskResolutionSchema.nullable(),
    resolutionSummary: z.string().nullable(),
    resolvedAt: z.iso.datetime().nullable(),
    mergedIntoTaskId: z.string().nullable(),
    source: z.enum(['user', 'pm_chat', 'pm_planner']),
    dependencyIds: z.array(z.string()),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((task, context) => {
    if ((task.status === 'queue') !== (task.queuePhase !== null)) {
      context.addIssue({ code: 'custom', message: 'Only Queue tasks have a Queue phase' })
    }
    const exactAction = task.needsYouAction !== null && Boolean(task.needsYouMessage?.trim())
    if ((task.status === 'needs_you') !== exactAction) {
      context.addIssue({
        code: 'custom',
        message: 'Needs you tasks require an exact requested action',
      })
    }
  })

export const queueReconciliationSchema = z.object({
  id: z.string(),
  requestedRevision: z.number().int().positive(),
  coalescedThroughRevision: z.number().int().positive(),
  status: z.enum(['pending', 'running', 'cancelling', 'completed', 'failed', 'cancelled']),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  requestedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})

export const taskCandidateSchema = z.object({
  task: taskSchema,
  score: z.number().min(0).max(1),
  match: z.enum(['likely', 'possible']),
})

export const taskMergeProposalSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sourceTaskId: z.string(),
  targetTaskId: z.string(),
  reason: z.string().min(1),
  status: z.enum(['pending', 'accepted', 'rejected']),
  proposedBy: z.string(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
})

export const taskProjectParamsSchema = z.object({ projectId: z.string().min(1) })
export const taskCreateParamsSchema = taskProjectParamsSchema.extend({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20_000).optional(),
  status: z.enum(['backlog', 'queue']).default('backlog'),
})
export const taskUpdateParamsSchema = taskProjectParamsSchema.extend({
  taskId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(20_000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
})
export const taskMoveParamsSchema = taskProjectParamsSchema
  .extend({
    taskId: z.string().min(1),
    status: taskStatusSchema,
    needsYouAction: needsYouActionSchema.optional(),
    needsYouMessage: z.string().trim().min(1).max(4_000).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.status === 'needs_you' &&
      (value.needsYouAction === undefined || value.needsYouMessage === undefined)
    ) {
      context.addIssue({ code: 'custom', message: 'Needs you requires an exact requested action' })
    }
  })
export const taskResolveParamsSchema = taskProjectParamsSchema.extend({
  taskId: z.string().min(1),
  resolution: taskResolutionSchema,
  summary: z.string().trim().min(1).max(4_000),
  mergedIntoTaskId: z.string().min(1).optional(),
})
export const taskSearchParamsSchema = taskProjectParamsSchema.extend({
  query: z.string().trim().min(1).max(1_000),
  limit: z.number().int().min(1).max(20).default(8),
})
export const taskMergeDecisionParamsSchema = taskProjectParamsSchema.extend({
  proposalId: z.string().min(1),
  decision: z.enum(['accept', 'reject']),
})

export type Task = z.infer<typeof taskSchema>
export type QueueReconciliation = z.infer<typeof queueReconciliationSchema>
export type TaskCandidate = z.infer<typeof taskCandidateSchema>
export type TaskMergeProposal = z.infer<typeof taskMergeProposalSchema>
