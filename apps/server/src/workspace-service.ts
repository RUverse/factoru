import type {
  ConversationMessageRecord,
  ConversationRecord,
  FactoruDatabase,
  PlannerProbeRecord,
  WorkerTypeRecord,
  TaskRecord,
  ExecutionRunRecord,
  ExecutionStage,
} from '@factoru/database'
import {
  workspaceSchema,
  type ConversationMessage,
  type MemoryEntry,
  type PlannerProbe,
  type WorkerType,
  type Workspace,
  type Task,
  type ExecutionRun,
} from '@factoru/protocol'
import type {
  ConversationMessage as OrchestrationConversationMessage,
  ConversationRef,
  RunCorrelation,
  RunSnapshot,
  ProjectRuntimeConfigurator,
  FormulaVariableValue,
} from '@factoru/gas-city'
import { ApplicationError } from './project-service.js'
import { CapsuleIntegrationError, type ExecutionCapsuleManager } from './capsule-service.js'

export interface ProjectManagerOrchestrator {
  registerConversationAdapter(accountId: string, displayName: string): Promise<void>
  bindConversation(conversation: ConversationRef, agentName: string): Promise<void>
  sendConversationTurn(
    conversation: ConversationRef,
    turn: {
      messageId: string
      text: string
      authorId: string
      authorDisplayName: string
      receivedAt: string
    },
  ): Promise<void>
  readConversation(
    conversation: ConversationRef,
    afterSequence: number,
    limit?: number,
  ): Promise<OrchestrationConversationMessage[]>
  startRun(request: {
    rigName: string
    formulaName: string
    target: string
    title: string
    variables: Readonly<Record<string, FormulaVariableValue>>
    requestId?: string
  }): Promise<RunCorrelation>
  describeRun(runId: string, workflowRootBeadId: string): Promise<RunSnapshot>
  readRunUsage?(
    runId: string,
    startingEventSeq: number,
  ): Promise<{ inputTokens: number; outputTokens: number; estimatedCostUsd: number }>
  cancelRun(runId: string): Promise<void>
}

function messageProjection(record: ConversationMessageRecord): ConversationMessage {
  return {
    id: record.id,
    role: record.role,
    text: record.text,
    authorDisplayName: record.authorDisplayName,
    inReplyToMessageId: record.inReplyToMessageId,
    deliveryState: record.deliveryState,
    tokenUsage:
      record.tokenInput !== null && record.tokenOutput !== null
        ? { input: record.tokenInput, output: record.tokenOutput }
        : null,
    toolActivity: record.toolActivity as ConversationMessage['toolActivity'],
    createdAt: record.createdAt,
  }
}

function workerProjection(record: WorkerTypeRecord): WorkerType {
  return {
    kind: record.kind,
    displayName: record.displayName,
    promptOverride: record.promptOverride,
    defaultFormula: record.defaultFormula,
    capacity: 1,
    allowedTools: record.allowedTools,
    memoryPolicy: record.memoryPolicy,
    version: record.version,
    modelBindings: record.modelBindings,
    updatedAt: record.updatedAt,
  }
}

function plannerProjection(record: PlannerProbeRecord | null): PlannerProbe | null {
  return record
    ? {
        id: record.id,
        status: record.status,
        error:
          record.errorCode && record.errorMessage
            ? { code: record.errorCode, message: record.errorMessage }
            : null,
        requestedAt: record.requestedAt,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
      }
    : null
}

function taskProjection(record: TaskRecord): Task {
  return {
    id: record.id,
    projectId: record.projectId,
    title: record.title,
    description: record.description,
    status: record.status,
    queuePhase: record.queuePhase,
    priority: record.priority,
    queueOrder: record.queueOrder,
    workerTypeKind: record.workerTypeKind,
    formulaName: record.formulaName,
    needsYouAction: record.needsYouAction,
    needsYouMessage: record.needsYouMessage,
    resolution: record.resolution,
    resolutionSummary: record.resolutionSummary,
    resolvedAt: record.resolvedAt,
    mergedIntoTaskId: record.mergedIntoTaskId,
    source: record.source,
    dependencyIds: record.dependencyIds,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function executionProjection(record: ExecutionRunRecord): ExecutionRun {
  return {
    id: record.id,
    taskId: record.taskId,
    formulaName: record.formulaName,
    formulaVersion: record.formulaVersion,
    formulaHash: record.formulaHash,
    status: record.status,
    stage: record.stage,
    capsule:
      record.capsuleId && record.capsulePath && record.branchName && record.baseBranch
        ? {
            id: record.capsuleId,
            path: record.capsulePath,
            branchName: record.branchName,
            baseBranch: record.baseBranch,
          }
        : null,
    steps: record.steps,
    logs: record.logs,
    usage: record.usage,
    reviewPackage: record.reviewPackage,
    error:
      record.errorCode && record.errorMessage
        ? { code: record.errorCode, message: record.errorMessage }
        : null,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    updatedAt: record.updatedAt,
  }
}

export class WorkspaceService {
  readonly #database: FactoruDatabase
  readonly #orchestrator: ProjectManagerOrchestrator
  readonly #configurator: ProjectRuntimeConfigurator | null
  readonly #capsules: ExecutionCapsuleManager | null
  readonly #cityName: string
  readonly #packVersion: string
  #adapterRegistered = false

  constructor(
    database: FactoruDatabase,
    orchestrator: ProjectManagerOrchestrator,
    configurator: ProjectRuntimeConfigurator | null = null,
    execution: {
      capsules: ExecutionCapsuleManager
      cityName: string
      packVersion: string
    } | null = null,
  ) {
    this.#database = database
    this.#orchestrator = orchestrator
    this.#configurator = configurator
    this.#capsules = execution?.capsules ?? null
    this.#cityName = execution?.cityName ?? ''
    this.#packVersion = execution?.packVersion ?? ''
  }

  get(projectId: string): Workspace {
    if (!this.#database.getProject(projectId)) {
      throw new ApplicationError('not_found', 'Project not found')
    }
    const factory = this.#database.product.factorySettings(projectId)
    const conversation = this.#database.product.getConversation(projectId)
    if (!factory || factory.templateId !== 'software-project' || !conversation) {
      throw new ApplicationError('product_state_missing', 'Project workspace is incomplete')
    }
    const memory: MemoryEntry[] = this.#database.product.listMemory(projectId).map((entry) => ({
      id: entry.id,
      scope: entry.scope,
      workerTypeKind: entry.workerTypeKind,
      content: entry.content,
      provenance: { kind: entry.provenanceKind, ref: entry.provenanceRef },
      version: entry.version,
      supersedesId: entry.supersedesId,
      createdAt: entry.createdAt,
    }))
    return workspaceSchema.parse({
      projectId,
      factory,
      workerTypes: this.#database.product.listWorkerTypes(projectId).map(workerProjection),
      conversation: this.#conversationProjection(conversation),
      memory,
      plannerProbe: plannerProjection(this.#database.product.latestPlannerProbe(projectId)),
      tasks: this.#database.tasks.listActive(projectId).map(taskProjection),
      recentTaskResolutions: this.#database.tasks.listRecentResolved(projectId).map(taskProjection),
      queueReconciliation: (() => {
        const reconciliation =
          this.#database.tasks.activeReconciliation(projectId) ??
          this.#database.tasks.pendingReconciliation(projectId) ??
          this.#database.tasks.latestReconciliation(projectId)
        return reconciliation
          ? {
              id: reconciliation.id,
              requestedRevision: reconciliation.requestedRevision,
              coalescedThroughRevision: reconciliation.coalescedThroughRevision,
              status: reconciliation.status,
              error:
                reconciliation.errorCode && reconciliation.errorMessage
                  ? { code: reconciliation.errorCode, message: reconciliation.errorMessage }
                  : null,
              requestedAt: reconciliation.requestedAt,
              startedAt: reconciliation.startedAt,
              finishedAt: reconciliation.finishedAt,
            }
          : null
      })(),
      taskMergeProposals: this.#database.tasks.listMergeProposals(projectId),
      taskRuns: this.#database.tasks.listExecutionRuns(projectId).map(executionProjection),
    })
  }

  sendMessage(projectId: string, text: string, authorDisplayName: string): ConversationMessage {
    const conversation = this.#requireConversation(projectId)
    return messageProjection(
      this.#database.product.addUserMessage(conversation.id, text, authorDisplayName),
    )
  }

  updateModelBinding(input: {
    projectId: string
    workerTypeKind: 'project_manager' | 'software_engineer'
    slot: string
    provider: string | null
    model: string | null
  }): WorkerType {
    this.#requireConversation(input.projectId)
    try {
      return workerProjection(
        this.#database.product.updateModelBinding(
          input.projectId,
          input.workerTypeKind,
          input.slot,
          input.provider,
          input.model,
        ),
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_model_slot') {
        throw new ApplicationError(
          'invalid_model_slot',
          `Model slot ${input.slot} does not belong to ${input.workerTypeKind}`,
        )
      }
      if (error instanceof Error && error.message === 'incomplete_model_binding') {
        throw new ApplicationError(
          'invalid_model_binding',
          'Provider and model must be configured together',
        )
      }
      throw error
    }
  }

  addMemory(input: {
    projectId: string
    scope: 'project' | 'worker_type'
    workerTypeKind?: 'project_manager' | 'software_engineer'
    content: string
    provenanceRef: string
    supersedesId?: string
  }): MemoryEntry {
    this.#requireConversation(input.projectId)
    const entry = this.#database.product.addMemoryEntry({
      ...input,
      provenanceKind: 'user_edit',
    })
    return {
      id: entry.id,
      scope: entry.scope,
      workerTypeKind: entry.workerTypeKind,
      content: entry.content,
      provenance: { kind: entry.provenanceKind, ref: entry.provenanceRef },
      version: entry.version,
      supersedesId: entry.supersedesId,
      createdAt: entry.createdAt,
    }
  }

  async startPlannerProbe(projectId: string): Promise<PlannerProbe> {
    const project = this.#database.getProject(projectId)
    if (!project) throw new ApplicationError('not_found', 'Project not found')
    const existing = this.#database.product.activePlannerProbe(projectId)
    if (existing) return plannerProjection(existing)!
    const probe = this.#database.product.createPlannerProbe(projectId)
    try {
      const correlation = await this.#orchestrator.startRun({
        rigName: project.rig.rigName,
        formulaName: 'factoru-planner-probe',
        target: `${project.rig.rigName}/factoru.project-manager-planner`,
        title: `Project Manager planner probe for ${project.name}`,
        variables: { project_id: project.id },
      })
      return plannerProjection(this.#database.product.startPlannerProbe(probe.id, correlation))!
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#database.product.finishPlannerProbe(probe.id, 'failed', {
        code: 'planner_dispatch_failed',
        message,
      })
      throw new ApplicationError('planner_dispatch_failed', message)
    }
  }

  async cancelPlannerProbe(projectId: string, plannerProbeId: string): Promise<PlannerProbe> {
    const active = this.#database.product.activePlannerProbe(projectId)
    if (!active || active.id !== plannerProbeId) {
      throw new ApplicationError('not_found', 'Active planner probe not found')
    }
    const cancelling = this.#database.product.requestPlannerCancellation(active.id)
    if (!active.runId) {
      return plannerProjection(this.#database.product.finishPlannerProbe(active.id, 'cancelled'))!
    }
    try {
      await this.#orchestrator.cancelRun(active.runId)
      return plannerProjection(cancelling)!
    } catch (error) {
      throw new ApplicationError(
        'planner_cancel_failed',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async cancelExecution(projectId: string, runId: string): Promise<ExecutionRun> {
    const run = this.#requireExecution(projectId, runId)
    this.#database.tasks.requestExecutionCancellation(run.id)
    if (!run.runId) {
      return executionProjection(this.#database.tasks.finishExecution(run.id, 'cancelled'))
    }
    try {
      await this.#orchestrator.cancelRun(run.runId)
      return executionProjection(this.#database.tasks.getExecutionRun(run.id)!)
    } catch (error) {
      throw new ApplicationError(
        'execution_cancel_failed',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  retryExecution(projectId: string, runId: string): Task {
    this.#requireExecution(projectId, runId)
    return taskProjection(this.#database.tasks.requeueExecution(runId))
  }

  requestExecutionChanges(projectId: string, runId: string, feedback: string): Task {
    this.#requireExecution(projectId, runId)
    return taskProjection(this.#database.tasks.requeueExecution(runId, feedback))
  }

  approveExecution(projectId: string, runId: string, summary: string, actorId: string): Task {
    this.#requireExecution(projectId, runId)
    return taskProjection(this.#database.tasks.approveExecution(runId, summary, actorId))
  }

  archiveExecution(projectId: string, runId: string): ExecutionRun {
    this.#requireExecution(projectId, runId)
    return executionProjection(this.#database.tasks.archiveExecution(runId))
  }

  async process(): Promise<void> {
    if (this.#database.listProjects().length === 0) return
    try {
      await this.#reconcileRuntimeConfiguration()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const project of this.#database.listProjects()) {
        const conversation = this.#database.product.getConversation(project.id)
        if (conversation) {
          this.#database.product.setConversationStatus(
            conversation.id,
            'needs_attention',
            'runtime_configuration_failed',
            message,
          )
        }
      }
      return
    }
    await this.#ensureAdapter()
    await this.#deliverPendingMessages()
    for (const project of this.#database.listProjects()) {
      await this.#syncConversation(project.id)
      await this.#observePlanner(project.id)
      await this.#observeQueueReconciliation(project.id)
      await this.#observeExecution(project.id)
    }
    await this.#dispatchQueueReconciliation()
    if (this.#capsules) {
      this.#database.tasks.admitNextExecution({
        cityName: this.#cityName,
        packVersion: this.#packVersion,
      })
      await this.#dispatchExecution()
    }
  }

  async #ensureAdapter(): Promise<void> {
    if (this.#adapterRegistered) return
    await this.#orchestrator.registerConversationAdapter('factoru-server', 'Factoru Server')
    this.#adapterRegistered = true
  }

  async #reconcileRuntimeConfiguration(): Promise<void> {
    if (!this.#configurator) return
    await this.#configurator.reconcile(
      this.#database.listProjects().map((project) => {
        const workers = this.#database.product.listWorkerTypes(project.id)
        const conversation = this.#database.product.getConversation(project.id)
        if (!conversation) {
          throw new ApplicationError('product_state_missing', 'Project conversation is missing')
        }
        const binding = (worker: 'project_manager' | 'software_engineer', slot: string) => {
          const value = workers
            .find((item) => item.kind === worker)
            ?.modelBindings.find((item) => item.slot === slot)
          return { provider: value?.provider ?? null, model: value?.model ?? null }
        }
        return {
          projectId: project.id,
          projectName: project.name,
          rigName: project.rig.rigName,
          chatAgentName: conversation.agentName,
          chat: binding('project_manager', 'chat'),
          planning: binding('project_manager', 'planning'),
          implementation: binding('software_engineer', 'implementation'),
          review: binding('software_engineer', 'review'),
        }
      }),
    )
  }

  async #deliverPendingMessages(): Promise<void> {
    for (const delivery of this.#database.product.claimConversationDeliveries()) {
      const conversation = this.#database.product.getConversationById(
        delivery.message.conversationId,
      )
      const project = conversation ? this.#database.getProject(conversation.projectId) : null
      if (!conversation || !project) continue
      try {
        const ref = this.#conversationRef(conversation, project.rig.rigName)
        await this.#orchestrator.bindConversation(ref, conversation.agentName)
        await this.#orchestrator.sendConversationTurn(ref, {
          messageId: delivery.message.id,
          text: delivery.message.text,
          authorId: 'factoru-owner',
          authorDisplayName: delivery.message.authorDisplayName,
          receivedAt: delivery.message.createdAt,
        })
        this.#database.product.completeConversationDelivery(delivery.outboxId, delivery.message.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const retryable =
          typeof error === 'object' && error !== null && 'retryable' in error
            ? error.retryable === true
            : true
        this.#database.product.failConversationDelivery(
          delivery.outboxId,
          delivery.message.id,
          retryable ? delivery.attemptCount : 6,
          'conversation_delivery_failed',
          message,
        )
      }
    }
  }

  async #syncConversation(projectId: string): Promise<void> {
    const conversation = this.#requireConversation(projectId)
    const project = this.#database.getProject(projectId)!
    try {
      const ref = this.#conversationRef(conversation, project.rig.rigName)
      const messages = await this.#orchestrator.readConversation(ref, conversation.transcriptCursor)
      for (const message of messages) {
        this.#database.product.storeTranscriptMessage(conversation.id, {
          sequence: message.sequence,
          providerMessageId: message.providerMessageId,
          role: message.role,
          text: message.text,
          authorDisplayName: message.authorDisplayName,
          inReplyToMessageId: message.inReplyToMessageId,
          createdAt: message.createdAt,
        })
      }
      this.#database.product.setConversationStatus(conversation.id, 'ready')
    } catch (error) {
      this.#database.product.setConversationStatus(
        conversation.id,
        'offline',
        'conversation_sync_failed',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async #observePlanner(projectId: string): Promise<void> {
    const probe = this.#database.product.activePlannerProbe(projectId)
    if (!probe?.runId || !probe.workflowRootBeadId) return
    try {
      const snapshot = await this.#orchestrator.describeRun(probe.runId, probe.workflowRootBeadId)
      if (snapshot.partial || snapshot.steps.length === 0) return
      const statuses = snapshot.steps.map((step) => step.status)
      if (statuses.some((status) => status === 'failed')) {
        this.#database.product.finishPlannerProbe(probe.id, 'failed', {
          code: 'planner_probe_failed',
          message: 'The planner probe reported a failed step.',
        })
      } else if (statuses.some((status) => status === 'cancelled')) {
        this.#database.product.finishPlannerProbe(probe.id, 'cancelled')
      } else if (statuses.every((status) => status === 'completed' || status === 'skipped')) {
        this.#database.product.finishPlannerProbe(probe.id, 'completed')
      }
    } catch {
      // A transient observation failure leaves the durable run active. The next
      // reactor pass retries from its persisted correlation.
    }
  }

  async #dispatchQueueReconciliation(): Promise<void> {
    const claimed = this.#database.tasks.claimNextReconciliation()
    if (!claimed) return
    const project = this.#database.getProject(claimed.reconciliation.projectId)
    if (!project) return
    try {
      const correlation = await this.#orchestrator.startRun({
        rigName: project.rig.rigName,
        formulaName: 'queue-reconcile',
        target: `${project.rig.rigName}/factoru.project-manager-planner`,
        title: `Reconcile Queue revision ${claimed.reconciliation.coalescedThroughRevision} for ${project.name}`,
        variables: {
          project_id: project.id,
          reconciliation_id: claimed.reconciliation.id,
          queue_revision: claimed.reconciliation.coalescedThroughRevision,
        },
        requestId: claimed.reconciliation.id,
      })
      this.#database.tasks.startReconciliation(
        claimed.reconciliation.id,
        correlation,
        claimed.outboxId,
      )
    } catch (error) {
      this.#database.tasks.deferReconciliationDispatch(
        claimed.outboxId,
        claimed.reconciliation.id,
        claimed.attemptCount,
        {
          code: 'queue_reconciliation_dispatch_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      )
    }
  }

  async #observeQueueReconciliation(projectId: string): Promise<void> {
    const reconciliation = this.#database.tasks.activeReconciliation(projectId)
    if (!reconciliation?.runId || !reconciliation.workflowRootBeadId) return
    try {
      const snapshot = await this.#orchestrator.describeRun(
        reconciliation.runId,
        reconciliation.workflowRootBeadId,
      )
      if (snapshot.partial || snapshot.steps.length === 0) return
      const statuses = snapshot.steps.map((step) => step.status)
      if (statuses.some((status) => status === 'failed')) {
        this.#database.tasks.finishReconciliation(reconciliation.id, 'failed', {
          code: 'queue_reconciliation_failed',
          message: 'The Project Manager planning step failed.',
        })
      } else if (statuses.some((status) => status === 'cancelled')) {
        this.#database.tasks.finishReconciliation(reconciliation.id, 'cancelled')
      } else if (statuses.every((status) => status === 'completed' || status === 'skipped')) {
        this.#database.tasks.finishReconciliation(reconciliation.id, 'completed')
      }
    } catch {
      // Persisted correlation survives transient observation failures and is
      // retried by the next reactor pass.
    }
  }

  async #dispatchExecution(): Promise<void> {
    if (!this.#capsules) return
    const claimed = this.#database.tasks.claimExecutionDispatch()
    if (!claimed) return
    const project = this.#database.getProject(claimed.run.projectId)
    const task = this.#database.tasks.get(claimed.run.taskId)
    if (!project || !task) return
    try {
      const capsule = await this.#capsules.prepare(project, claimed.run)
      this.#database.tasks.setExecutionCapsule(claimed.run.id, {
        id: capsule.id,
        path: capsule.worktreePath,
        branchName: capsule.branchName,
        baseBranch: capsule.baseBranch,
      })
      const correlation = await this.#orchestrator.startRun({
        rigName: project.rig.rigName,
        formulaName: 'software-delivery',
        target: `${project.rig.rigName}/factoru.software-implementer`,
        title: `Deliver ${task.title}`,
        variables: {
          task_id: task.id,
          run_id: claimed.run.id,
          request: [task.title, task.description].filter(Boolean).join('\n\n'),
          capsule_path: capsule.worktreePath,
          base_branch: capsule.baseBranch,
          evidence_path: capsule.evidencePath,
          verification_script: capsule.verificationScript,
          implementation_target: `${project.rig.rigName}/factoru.software-implementer`,
          review_target: `${project.rig.rigName}/factoru.software-reviewer`,
        },
        requestId: claimed.run.requestId,
      })
      this.#database.tasks.startExecution(claimed.run.id, correlation, claimed.outboxId)
    } catch (error) {
      this.#database.tasks.deferExecutionDispatch(
        claimed.outboxId,
        claimed.run.id,
        claimed.attemptCount,
        {
          code: 'execution_dispatch_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      )
    }
  }

  async #observeExecution(projectId: string): Promise<void> {
    if (!this.#capsules) return
    const run = this.#database.tasks.activeExecution(projectId)
    if (!run?.runId || !run.workflowRootBeadId) return
    let snapshot: RunSnapshot
    try {
      snapshot = await this.#orchestrator.describeRun(run.runId, run.workflowRootBeadId)
    } catch {
      return
    }
    if (snapshot.partial || snapshot.steps.length === 0) return
    const statuses = snapshot.steps.map((step) => step.status)
    const stage = this.#executionStage(snapshot)
    let usage = run.usage
    if (this.#orchestrator.readRunUsage) {
      try {
        const observed = await this.#orchestrator.readRunUsage(run.runId, run.startingEventCursor)
        usage = {
          inputTokens: observed.inputTokens,
          outputTokens: observed.outputTokens,
          estimatedCostUsd: observed.estimatedCostUsd,
        }
      } catch {
        // A later reactor pass retries optional usage telemetry.
      }
    }
    let logs = run.logs
    try {
      const project = this.#database.getProject(projectId)
      if (project) {
        const capsule = await this.#capsules.prepare(project, run)
        logs = [...this.#capsules.readLogs(capsule)]
      }
    } catch {
      // Evidence may be between atomic writes while an agent is working.
    }
    this.#database.tasks.observeExecution(run.id, {
      stage,
      steps: snapshot.steps.map((step) => ({
        id: step.stepId,
        title: step.title,
        status: step.status,
      })),
      logs,
      usage,
    })
    if (statuses.some((status) => status === 'failed')) {
      this.#database.tasks.finishExecution(run.id, 'failed', {
        error: { code: 'software_delivery_failed', message: 'A software-delivery step failed.' },
      })
      return
    }
    if (statuses.some((status) => status === 'cancelled')) {
      this.#database.tasks.finishExecution(run.id, 'cancelled')
      return
    }
    if (!statuses.every((status) => status === 'completed' || status === 'skipped')) return

    const project = this.#database.getProject(projectId)
    const task = this.#database.tasks.get(run.taskId)
    if (!project || !task) return
    try {
      this.#database.tasks.observeExecution(run.id, {
        stage: 'integration',
        steps: snapshot.steps.map((step) => ({
          id: step.stepId,
          title: step.title,
          status: step.status,
        })),
        logs,
        usage,
      })
      const capsule = await this.#capsules.prepare(project, run)
      const reviewPackage = await this.#capsules.finalize(project, run, capsule, {
        request: task.title,
        plan: task.description,
        usage,
      })
      this.#database.tasks.finishExecution(run.id, 'completed', { reviewPackage, usage })
    } catch (error) {
      if (!(error instanceof CapsuleIntegrationError)) return
      this.#database.tasks.finishExecution(run.id, 'failed', {
        error: { code: `capsule_${error.kind}`, message: error.message },
        needsYouAction: error.kind === 'conflict' ? 'resolve_conflict' : 'recover_failure',
      })
    }
  }

  #executionStage(snapshot: RunSnapshot): ExecutionStage {
    const active = snapshot.steps.find((step) =>
      ['running', 'pending', 'blocked', 'cancelling'].includes(step.status),
    )
    const value = `${active?.stepId ?? ''} ${active?.title ?? ''}`.toLowerCase()
    if (value.includes('review')) return 'review'
    if (value.includes('check') || value.includes('verify')) return 'checks'
    if (value.includes('final')) return 'review'
    return 'implementation'
  }

  #requireConversation(projectId: string): ConversationRecord {
    if (!this.#database.getProject(projectId)) {
      throw new ApplicationError('not_found', 'Project not found')
    }
    const conversation = this.#database.product.getConversation(projectId)
    if (!conversation) {
      throw new ApplicationError('product_state_missing', 'Project conversation is missing')
    }
    return conversation
  }

  #requireExecution(projectId: string, runId: string): ExecutionRunRecord {
    this.#requireConversation(projectId)
    const run = this.#database.tasks.getExecutionRun(runId)
    if (!run || run.projectId !== projectId) {
      throw new ApplicationError('not_found', 'Execution run not found')
    }
    return run
  }

  #conversationProjection(record: ConversationRecord) {
    return {
      id: record.id,
      status: record.status,
      error:
        record.errorCode && record.errorMessage
          ? { code: record.errorCode, message: record.errorMessage }
          : null,
      messages: this.#database.product.listMessages(record.id).map(messageProjection),
      transcriptCursor: record.transcriptCursor,
      updatedAt: record.updatedAt,
    }
  }

  #conversationRef(conversation: ConversationRecord, rigName: string): ConversationRef {
    return {
      scopeId: rigName,
      accountId: conversation.gasCityAccountId,
      conversationId: conversation.gasCityConversationId,
    }
  }
}
