import { z } from 'zod'
import type { AgentRole, AgentToolCredentialRecord, FactoruDatabase } from '@factoru/database'

export const AGENT_TOOL_SESSION_PATH = '/internal/v1/agent-tools/session'
export const AGENT_TOOL_CALL_PATH = '/internal/v1/agent-tools/call'

export const agentToolSessionRequestSchema = z.object({
  rigName: z.string().trim().min(1).max(120),
  agentName: z.string().trim().min(1).max(200),
  sessionId: z.string().trim().min(1).max(200),
})

export const agentToolCallRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  tool: z.string().trim().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()).default({}),
})

export interface AgentToolCallResponse {
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

function roleForAgent(agentName: string, chatAgentName: string): AgentRole | null {
  const localName = agentName.split('/').at(-1) ?? agentName
  if (localName === chatAgentName || localName.includes('project-manager-chat')) return 'pm_chat'
  if (localName.includes('project-manager-planner')) return 'pm_planner'
  if (
    localName.includes('software-implementer') ||
    localName.includes('implementation-worker') ||
    localName.includes('apply-findings')
  )
    return 'software_implementer'
  if (
    localName.includes('software-reviewer') ||
    localName.includes('reviewer') ||
    localName.includes('review-synthesizer') ||
    localName.includes('gap-analyst')
  )
    return 'software_reviewer'
  return null
}

function workerKind(role: AgentRole): 'project_manager' | 'software_engineer' {
  return role === 'pm_chat' || role === 'pm_planner' ? 'project_manager' : 'software_engineer'
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}_required`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function optionalEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  name: string,
): T | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`invalid_${name}`)
  return value as T
}

export class AgentToolService {
  readonly #database: FactoruDatabase

  constructor(database: FactoruDatabase) {
    this.#database = database
  }

  createSession(input: z.infer<typeof agentToolSessionRequestSchema>): {
    token: string
    projectId: string
    role: AgentRole
    expiresAt: string
  } {
    const project = this.#database
      .listProjects()
      .find((candidate) => candidate.rig.rigName === input.rigName)
    if (!project) throw new Error('unknown_project_rig')
    const conversation = this.#database.product.getConversation(project.id)
    if (!conversation) throw new Error('project_conversation_missing')
    const role = roleForAgent(input.agentName, conversation.agentName)
    if (!role) throw new Error('unknown_agent_role')
    const minted = this.#database.agentTools.mint(project.id, role, input.sessionId)
    return {
      token: minted.token,
      projectId: project.id,
      role,
      expiresAt: minted.credential.expiresAt,
    }
  }

  call(rawToken: string, input: z.infer<typeof agentToolCallRequestSchema>): AgentToolCallResponse {
    const credential = this.#database.agentTools.authenticate(rawToken)
    if (!credential)
      return {
        ok: false,
        error: { code: 'unauthorized', message: 'Credential is invalid or expired' },
      }
    const replay = this.#database.agentTools.replay(credential.id, input.requestId)
    if (replay) return replay.response as AgentToolCallResponse

    return this.#database.connection.transaction(() => {
      const allowed = this.#allowedTools(credential)
      if (!allowed.has(input.tool)) {
        return this.#record(credential, input, 'denied', {
          ok: false,
          error: { code: 'forbidden', message: `${credential.role} cannot call ${input.tool}` },
        })
      }
      try {
        return this.#record(credential, input, 'accepted', {
          ok: true,
          result: this.#dispatch(credential, input.tool, input.arguments),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const expected =
          message.includes('required') ||
          message.startsWith('invalid_') ||
          message.startsWith('task_') ||
          message.startsWith('workflow_') ||
          message.startsWith('cross_project') ||
          message.startsWith('resource_') ||
          message.startsWith('memory_') ||
          message.startsWith('superseded_')
        return this.#record(credential, input, expected ? 'denied' : 'failed', {
          ok: false,
          error: { code: expected ? 'invalid_tool_request' : 'tool_failed', message },
        })
      }
    })()
  }

  #allowedTools(credential: AgentToolCredentialRecord): Set<string> {
    const worker = this.#database.product
      .listWorkerTypes(credential.projectId)
      .find((candidate) => candidate.kind === workerKind(credential.role))
    return new Set(worker?.allowedTools ?? [])
  }

  #dispatch(
    credential: AgentToolCredentialRecord,
    tool: string,
    args: Record<string, unknown>,
  ): unknown {
    const actorKind = credential.role === 'pm_chat' ? 'pm_chat' : 'pm_planner'
    const requireTask = (taskId: string) => {
      const task = this.#database.tasks.get(taskId)
      if (!task || task.projectId !== credential.projectId) throw new Error('task_not_found')
      return task
    }
    switch (tool) {
      case 'tasks.get':
        return requireTask(requireString(args.taskId, 'task_id'))
      case 'tasks.search':
        return requireString(args.query, 'query') === '*'
          ? this.#database.tasks
              .listActive(credential.projectId)
              .slice(
                0,
                typeof args.limit === 'number' && Number.isInteger(args.limit)
                  ? Math.max(1, Math.min(args.limit, 20))
                  : 20,
              )
          : this.#database.tasks.searchCandidates(
              credential.projectId,
              requireString(args.query, 'query'),
              typeof args.limit === 'number' ? args.limit : 8,
            )
      case 'tasks.create': {
        const status = optionalEnum(args.status, ['backlog', 'queue'], 'task_status') ?? 'backlog'
        return this.#database.tasks.create({
          projectId: credential.projectId,
          title: requireString(args.title, 'title'),
          description: optionalString(args.description),
          status,
          source: credential.role === 'pm_chat' ? 'pm_chat' : 'pm_planner',
          actorKind,
          actorId: credential.sessionId,
        })
      }
      case 'tasks.update': {
        const taskId = requireString(args.taskId, 'task_id')
        const task = requireTask(taskId)
        const requestedPreset =
          args.workflowPresetId === undefined
            ? args.formulaName === 'standard-build'
              ? 'standard-build'
              : args.formulaName === 'software-delivery'
                ? 'fast-patch'
                : undefined
            : optionalEnum(
                args.workflowPresetId,
                ['standard-build', 'fast-patch'] as const,
                'workflow_preset',
              )
        if (requestedPreset && task.workflowLockedByUser) {
          throw new Error('workflow_preset_user_locked')
        }
        return this.#database.tasks.update({
          taskId,
          title: optionalString(args.title),
          description: optionalString(args.description),
          priority: typeof args.priority === 'number' ? args.priority : undefined,
          queuePhase: optionalEnum(
            args.queuePhase,
            [
              'awaiting_triage',
              'triaging',
              'ready',
              'waiting_dependency',
              'waiting_capacity',
            ] as const,
            'queue_phase',
          ),
          workerTypeKind:
            args.workerTypeKind === null
              ? null
              : optionalEnum(
                  args.workerTypeKind,
                  ['project_manager', 'software_engineer'] as const,
                  'worker_type',
                ),
          workflowPresetId: requestedPreset,
          workflowSelectionSource: requestedPreset ? 'pm' : undefined,
          workflowLockedByUser: requestedPreset ? false : undefined,
          needsYouAction: optionalEnum(
            args.needsYouAction,
            ['clarify', 'approve', 'review', 'resolve_conflict', 'recover_failure'] as const,
            'needs_you_action',
          ),
          needsYouMessage: optionalString(args.needsYouMessage),
          actorKind,
          actorId: credential.sessionId,
        })
      }
      case 'tasks.move': {
        const taskId = requireString(args.taskId, 'task_id')
        requireTask(taskId)
        return this.#database.tasks.move({
          taskId,
          status: optionalEnum(
            requireString(args.status, 'status'),
            ['backlog', 'queue', 'in_progress', 'needs_you'] as const,
            'task_status',
          )!,
          needsYouAction: optionalEnum(
            args.needsYouAction,
            ['clarify', 'approve', 'review', 'resolve_conflict', 'recover_failure'] as const,
            'needs_you_action',
          ),
          needsYouMessage: optionalString(args.needsYouMessage),
          actorKind,
          actorId: credential.sessionId,
        })
      }
      case 'tasks.queue': {
        const taskId = requireString(args.taskId, 'task_id')
        requireTask(taskId)
        return this.#database.tasks.move({
          taskId,
          status: 'queue',
          actorKind,
          actorId: credential.sessionId,
        })
      }
      case 'tasks.set_dependencies': {
        const taskId = requireString(args.taskId, 'task_id')
        requireTask(taskId)
        if (
          !Array.isArray(args.dependencyIds) ||
          args.dependencyIds.length > 100 ||
          args.dependencyIds.some((id) => typeof id !== 'string')
        ) {
          throw new Error('invalid_dependency_ids')
        }
        return this.#database.tasks.setDependencies({
          taskId,
          dependencyIds: args.dependencyIds as string[],
          actorKind,
          actorId: credential.sessionId,
        })
      }
      case 'tasks.set_resource_intents': {
        const taskId = requireString(args.taskId, 'task_id')
        requireTask(taskId)
        if (!Array.isArray(args.intents) || args.intents.length > 32) {
          throw new Error('invalid_resource_intents')
        }
        const intents = args.intents.map((value) => {
          if (!value || typeof value !== 'object') throw new Error('invalid_resource_intents')
          const intent = value as Record<string, unknown>
          return {
            kind: optionalEnum(
              requireString(intent.kind, 'resource_kind'),
              ['repository_path', 'service', 'database', 'exclusive_resource'] as const,
              'resource_kind',
            )!,
            name: requireString(intent.name, 'resource_name'),
            access: optionalEnum(
              requireString(intent.access, 'resource_access'),
              ['read', 'write', 'exclusive'] as const,
              'resource_access',
            )!,
          }
        })
        return this.#database.orchestration.setResourceIntents(
          credential.projectId,
          taskId,
          intents,
        )
      }
      case 'tasks.split': {
        const taskId = requireString(args.taskId, 'task_id')
        requireTask(taskId)
        if (!Array.isArray(args.children) || args.children.length < 2 || args.children.length > 8) {
          throw new Error('task_split_size_invalid')
        }
        const children = args.children.map((value) => {
          if (!value || typeof value !== 'object') throw new Error('invalid_split_child')
          const child = value as Record<string, unknown>
          return {
            title: requireString(child.title, 'title'),
            description: optionalString(child.description) ?? '',
          }
        })
        return this.#database.orchestration.splitTask({
          projectId: credential.projectId,
          taskId,
          reason: requireString(args.reason, 'reason'),
          children,
          actorKind,
          actorId: credential.sessionId,
        })
      }
      case 'tasks.append_evidence': {
        const taskId = requireString(args.taskId, 'task_id')
        requireTask(taskId)
        const sourceRef = requireString(args.sourceRef, 'source_ref')
        const summary = requireString(args.summary, 'summary')
        const evidence = this.#database.orchestration.addEvidence(credential.projectId, taskId, {
          kind:
            optionalEnum(args.kind, ['request', 'scope', 'decision'] as const, 'evidence_kind') ??
            'scope',
          summary,
          provenance: { kind: 'pm_judgment', ref: sourceRef },
        })
        this.#database.orchestration.recordDuplicateDecision({
          projectId: credential.projectId,
          sourceKind: 'new_request',
          sourceRef,
          candidateTaskId: taskId,
          decision: 'append_evidence',
          reason: summary,
          decidedBy: credential.sessionId,
        })
        return evidence
      }
      case 'tasks.propose_merge': {
        const sourceTaskId = requireString(args.sourceTaskId, 'source_task_id')
        const targetTaskId = requireString(args.targetTaskId, 'target_task_id')
        requireTask(sourceTaskId)
        requireTask(targetTaskId)
        return this.#database.tasks.proposeMerge({
          projectId: credential.projectId,
          sourceTaskId,
          targetTaskId,
          reason: requireString(args.reason, 'reason'),
          proposedBy: credential.sessionId,
          actorKind,
        })
      }
      case 'tasks.resolve': {
        const taskId = requireString(args.taskId, 'task_id')
        requireTask(taskId)
        const resolution = requireString(args.resolution, 'resolution')
        if (resolution === 'superseded') throw new Error('superseded_requires_user_confirmation')
        const validatedResolution = optionalEnum(
          resolution,
          ['accepted', 'rejected', 'cancelled'],
          'task_resolution',
        )!
        return this.#database.tasks.resolve({
          taskId,
          resolution: validatedResolution,
          summary: requireString(args.summary, 'summary'),
          actorKind,
          actorId: credential.sessionId,
        })
      }
      case 'memory.read':
      case 'memory.search':
        return this.#database.orchestration.searchMemory(
          credential.projectId,
          optionalString(args.query) ?? '',
          workerKind(credential.role),
          typeof args.limit === 'number' ? args.limit : 8,
        )
      case 'memory.propose':
      case 'memory.propose_update':
        return this.#database.orchestration.proposeMemory({
          projectId: credential.projectId,
          scope:
            optionalEnum(args.scope, ['project', 'worker_type'] as const, 'memory_scope') ??
            'worker_type',
          workerTypeKind: args.scope === 'project' ? undefined : workerKind(credential.role),
          content: requireString(args.content, 'content'),
          provenanceKind: 'agent_proposal',
          provenanceRef: credential.sessionId,
          proposedBy: credential.sessionId,
        })
      case 'capacity.inspect': {
        const active = this.#database.tasks.activeExecution(credential.projectId)
        return { executionWipLimit: 1, admitted: active ? 1 : 0, available: active ? 0 : 1 }
      }
      case 'runs.inspect': {
        const requested = optionalString(args.runId)
        const runs = requested
          ? [this.#database.tasks.getExecutionRun(requested)].filter(Boolean)
          : this.#database.tasks.listExecutionRuns(credential.projectId).slice(0, 10)
        return runs.map((run) => {
          if (!run || run.projectId !== credential.projectId)
            throw new Error('invalid_run_reference')
          return {
            id: run.id,
            taskId: run.taskId,
            status: run.status,
            stage: run.stage,
            formulaName: run.formulaName,
            usage: run.usage,
            projectionState: run.projectionState,
            attempts: {
              verification: run.verificationAttempts,
              correction: run.correctionAttempts,
              transient: run.transientAttempts,
            },
          }
        })
      }
      case 'runs.context': {
        const runId = requireString(args.runId, 'run_id')
        const run = this.#database.tasks.getExecutionRun(runId)
        if (!run || run.projectId !== credential.projectId) throw new Error('invalid_run_reference')
        const task = requireTask(run.taskId)
        return {
          run: {
            id: run.id,
            status: run.status,
            stage: run.stage,
            formulaName: run.formulaName,
            usage: run.usage,
          },
          task,
          evidence: this.#database.orchestration.listEvidence(credential.projectId, task.id),
          resourceIntents: this.#database.orchestration.listResourceIntents(
            credential.projectId,
            task.id,
          ),
          memory: this.#database.orchestration.searchMemory(
            credential.projectId,
            `${task.title} ${task.description}`,
            workerKind(credential.role),
            8,
          ),
        }
      }
      case 'runs.report_evidence':
      case 'runs.report_review': {
        const runId = requireString(args.runId, 'run_id')
        const run = this.#database.tasks.getExecutionRun(runId)
        if (!run || run.projectId !== credential.projectId) throw new Error('invalid_run_reference')
        return this.#database.orchestration.addEvidence(credential.projectId, run.taskId, {
          kind: tool === 'runs.report_review' ? 'review' : 'check',
          summary: requireString(args.summary, 'summary'),
          provenance: { kind: 'agent_report', ref: runId },
        })
      }
      default:
        throw new Error('invalid_tool_name')
    }
  }

  #record(
    credential: AgentToolCredentialRecord,
    input: z.infer<typeof agentToolCallRequestSchema>,
    outcome: 'accepted' | 'denied' | 'failed',
    response: AgentToolCallResponse,
  ): AgentToolCallResponse {
    return this.#database.agentTools.record({
      credential,
      toolName: input.tool,
      requestId: input.requestId,
      outcome,
      summary: { argumentKeys: Object.keys(input.arguments).sort() },
      response,
    }).response as AgentToolCallResponse
  }
}
