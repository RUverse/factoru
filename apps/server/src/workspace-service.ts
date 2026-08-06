import type {
  ConversationMessageRecord,
  ConversationRecord,
  FactoruDatabase,
  PlannerProbeRecord,
  WorkerTypeRecord,
} from '@factoru/database'
import {
  workspaceSchema,
  type ConversationMessage,
  type MemoryEntry,
  type PlannerProbe,
  type WorkerType,
  type Workspace,
} from '@factoru/protocol'
import type {
  ConversationMessage as OrchestrationConversationMessage,
  ConversationRef,
  RunCorrelation,
  RunSnapshot,
  ProjectRuntimeConfigurator,
} from '@factoru/gas-city'
import { ApplicationError } from './project-service.js'

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
    variables: Readonly<Record<string, string>>
  }): Promise<RunCorrelation>
  describeRun(runId: string, workflowRootBeadId: string): Promise<RunSnapshot>
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

export class WorkspaceService {
  readonly #database: FactoruDatabase
  readonly #orchestrator: ProjectManagerOrchestrator
  readonly #configurator: ProjectRuntimeConfigurator | null
  #adapterRegistered = false

  constructor(
    database: FactoruDatabase,
    orchestrator: ProjectManagerOrchestrator,
    configurator: ProjectRuntimeConfigurator | null = null,
  ) {
    this.#database = database
    this.#orchestrator = orchestrator
    this.#configurator = configurator
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
