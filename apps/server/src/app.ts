import { timingSafeEqual } from 'node:crypto'
import Fastify, { LogController, type FastifyError, type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import type { ServerId } from '@factoru/domain'
import type { FactoruDatabase, OwnerScope, TrustedDevice } from '@factoru/database'
import {
  CAPABILITY_HANDSHAKE,
  CAPABILITY_HEALTH,
  CAPABILITY_LIVE,
  CAPABILITY_LOCAL_ENROLLMENT,
  CAPABILITY_PAIRING,
  CAPABILITY_PROJECTS,
  CAPABILITY_REPOSITORY_ACCESS_CHECK,
  CAPABILITY_TRUSTED_DEVICES,
  CAPABILITY_CONVERSATIONS,
  CAPABILITY_WORKSPACES,
  CAPABILITY_WORKER_TYPES,
  CAPABILITY_PROJECT_BLUEPRINTS,
  CAPABILITY_WORKFLOW_PRESETS,
  CAPABILITY_MODEL_CATALOG,
  CAPABILITY_TASKS,
  CAPABILITY_QUEUE_RECONCILIATION,
  CAPABILITY_SOFTWARE_DELIVERY,
  CAPABILITY_SCOPED_STREAMS,
  CAPABILITY_RICH_CONVERSATIONS,
  CAPABILITY_IMAGE_ARTIFACTS,
  CAPABILITY_CONVERSATION_CONTEXT_RESET,
  CAPABILITY_ORCHESTRATION_DEPTH,
  CONNECTION_TICKET_PATH,
  HANDSHAKE_PATH,
  HEALTH_PATH,
  LIVE_PATH,
  LOCAL_ENROLLMENT_PATH,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PAIRING_EXCHANGE_PATH,
  PROTOCOL_VERSION,
  checkCompatibility,
  connectionTicketResponseSchema,
  descriptorFromHealth,
  deviceRevokeParamsSchema,
  conversationSendParamsSchema,
  conversationResetContextParamsSchema,
  handshakeRequestSchema,
  handshakeResponseSchema,
  healthResponseSchema,
  liveRequestSchema,
  localEnrollmentRequestSchema,
  memoryAddParamsSchema,
  modelBindingUpdateParamsSchema,
  pairingExchangeRequestSchema,
  pairingExchangeResponseSchema,
  problem,
  projectCreateParamsSchema,
  projectWorkflowDefaultUpdateParamsSchema,
  projectIdParamsSchema,
  projectPreviewParamsSchema,
  projectSnapshotSchema,
  projectSubscribeParamsSchema,
  plannerCancelParamsSchema,
  executionApproveParamsSchema,
  executionRequestChangesParamsSchema,
  executionRunParamsSchema,
  repositoryBrowseParamsSchema,
  repositoryAccessCheckParamsSchema,
  repositoryPreviewPathParamsSchema,
  type HealthResponse,
  type LiveRequest,
  taskCreateParamsSchema,
  taskMoveParamsSchema,
  taskMergeDecisionParamsSchema,
  taskResolveParamsSchema,
  taskSearchParamsSchema,
  taskUpdateParamsSchema,
  artifactSchema,
  conversationCancelParamsSchema,
  conversationHistoryParamsSchema,
  conversationRetryParamsSchema,
  streamSubscribeParamsSchema,
  streamUnsubscribeParamsSchema,
  taskSplitParamsSchema,
  taskEvidenceParamsSchema,
  taskResourceIntentsParamsSchema,
  memorySearchParamsSchema,
  memoryProposeUpdateParamsSchema,
  memoryDecideProposalParamsSchema,
  runDetailParamsSchema,
  runArtifactReadParamsSchema,
  type StreamResource,
} from '@factoru/protocol'
import type { ServerConfig } from './config.js'
import { SERVER_VERSION } from './version.js'
import { bearerDevice, requireScope, TicketStore } from './auth.js'
import { ApplicationError, type ProjectService } from './project-service.js'
import { RepositoryError } from './repositories.js'
import type { WorkspaceService } from './workspace-service.js'
import type { TaskService } from './task-service.js'
import {
  AGENT_TOOL_CALL_PATH,
  AGENT_TOOL_SESSION_PATH,
  agentToolCallRequestSchema,
  agentToolSessionRequestSchema,
  type AgentToolService,
} from './agent-tool-service.js'
import {
  GAS_CITY_CALLBACK_PATH,
  gasCityCallbackMessageId,
  gasCityOutboundCallbackSchema,
} from './gas-city-callback.js'
import type { ArtifactService } from './artifact-service.js'

export interface BuildServerOptions {
  serverId: ServerId
  version?: string
  logLevel?: ServerConfig['logLevel']
  startedAt?: Date
  now?: () => Date
  trustProxy?: boolean
  database?: FactoruDatabase
  projectService?: ProjectService
  workspaceService?: WorkspaceService
  taskService?: TaskService
  agentToolService?: AgentToolService
  artifactService?: ArtifactService
  /** Stops the dedicated Gas City runtime after application work has quiesced. */
  runtimeLifecycle?: { stop(): Promise<void> }
  /** Restart-scoped same-user proof. Never expose this through health or handshake. */
  localEnrollmentProof?: string
}

export const BASE_SERVER_CAPABILITIES = [CAPABILITY_HEALTH, CAPABILITY_HANDSHAKE]

function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '0:0:0:0:0:0:0:1'
}

function equalProof(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}

function responseError(
  socket: WebSocket,
  id: string,
  code: string,
  message: string,
  details?: unknown,
) {
  socket.send(
    JSON.stringify({
      id,
      ok: false,
      error: { code, message, ...(details === undefined ? {} : { details }) },
    }),
  )
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const version = options.version ?? SERVER_VERSION
  const startedAt = options.startedAt ?? new Date()
  const now = options.now ?? (() => new Date())
  const database = options.database
  const projects = options.projectService
  const workspaces = options.workspaceService
  const tasks = options.taskService
  const agentTools = options.agentToolService
  const artifacts = options.artifactService
  const capabilities =
    projects && database
      ? [
          ...BASE_SERVER_CAPABILITIES,
          CAPABILITY_PAIRING,
          ...(options.localEnrollmentProof ? [CAPABILITY_LOCAL_ENROLLMENT] : []),
          CAPABILITY_LIVE,
          CAPABILITY_PROJECTS,
          CAPABILITY_REPOSITORY_ACCESS_CHECK,
          CAPABILITY_TRUSTED_DEVICES,
          ...(workspaces
            ? [
                CAPABILITY_WORKSPACES,
                CAPABILITY_CONVERSATIONS,
                CAPABILITY_WORKER_TYPES,
                CAPABILITY_PROJECT_BLUEPRINTS,
                CAPABILITY_WORKFLOW_PRESETS,
                CAPABILITY_MODEL_CATALOG,
                CAPABILITY_SOFTWARE_DELIVERY,
                CAPABILITY_SCOPED_STREAMS,
                CAPABILITY_RICH_CONVERSATIONS,
                CAPABILITY_CONVERSATION_CONTEXT_RESET,
                ...(artifacts ? [CAPABILITY_IMAGE_ARTIFACTS] : []),
              ]
            : []),
          ...(tasks
            ? [CAPABILITY_TASKS, CAPABILITY_QUEUE_RECONCILIATION, CAPABILITY_ORCHESTRATION_DEPTH]
            : []),
        ]
      : BASE_SERVER_CAPABILITIES
  const tickets = new TicketStore()
  const subscribers = new Map<WebSocket, { deviceId: string; cursor: number }>()
  const streamSubscribers = new Map<
    WebSocket,
    Map<string, { deviceId: string; resource: StreamResource; cursor: number }>
  >()
  const activeSockets = new Map<WebSocket, string>()
  const pairingAttempts = new Map<string, number[]>()

  const app = Fastify({
    logger:
      options.logLevel === 'silent'
        ? false
        : {
            level: options.logLevel ?? 'info',
            redact: { paths: ['req.url'], censor: '[redacted]' },
          },
    // WebSocket tickets are intentionally passed in the upgrade URL. Fastify's
    // default request logging would otherwise persist those one-time secrets.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 9 * 1024 * 1024,
    trustProxy: options.trustProxy === true ? ['127.0.0.1', '::1'] : false,
  })

  app.addContentTypeParser(
    /^(?:application\/octet-stream|image\/(?:png|jpeg|gif|webp))$/,
    { parseAs: 'buffer', bodyLimit: 8 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  )

  function currentHealth(): HealthResponse {
    const storage = database?.storageHealth()
    return healthResponseSchema.parse({
      status: storage && storage.freeBytes < 512 * 1024 * 1024 ? 'degraded' : 'ok',
      serverId: options.serverId,
      serverVersion: version,
      protocolVersion: PROTOCOL_VERSION,
      minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
      capabilities,
      startedAt: startedAt.toISOString(),
      uptimeMs: Math.max(0, now().getTime() - startedAt.getTime()),
      storage,
    })
  }

  function protectedTransport(request: { ip: string; protocol: string }): boolean {
    return isLoopbackIp(request.ip) || request.protocol === 'https'
  }

  function publishEvents(): void {
    if (!projects) return
    for (const [socket, subscription] of subscribers) {
      if (socket.readyState !== socket.OPEN) continue
      const events = projects.snapshot(subscription.cursor).events
      for (const event of events) {
        socket.send(JSON.stringify({ type: 'project.event', event }))
        subscription.cursor = event.sequence
      }
    }
  }

  function sendStream(socket: WebSocket, value: unknown): boolean {
    if (socket.readyState !== socket.OPEN) return false
    if (socket.bufferedAmount > 1024 * 1024) {
      socket.close(1013, 'stream backpressure')
      return false
    }
    socket.send(JSON.stringify(value))
    return true
  }

  function streamCursor(resource: StreamResource): number {
    if (!database) return 0
    if (resource.kind === 'run') {
      const run = database.tasks.getExecutionRun(resource.runId)
      if (!run || run.projectId !== resource.projectId) {
        throw new ApplicationError('not_found', 'Run not found')
      }
      return database.orchestration.currentRunCursor(resource.runId)
    }
    if (resource.kind !== 'conversation') return database.currentSequence()
    const conversation = database.product.getConversationById(resource.conversationId)
    if (!conversation || conversation.projectId !== resource.projectId) {
      throw new ApplicationError('not_found', 'Conversation not found')
    }
    return database.conversations.currentStreamCursor(resource.conversationId)
  }

  async function streamData(resource: StreamResource, includeCatalog = false): Promise<unknown> {
    if (!projects) throw new ApplicationError('unavailable', 'Stream service is unavailable')
    if (resource.kind === 'shell') return { projects: projects.listProjects() }
    if (!workspaces) throw new ApplicationError('unavailable', 'Stream service is unavailable')
    const workspace = includeCatalog
      ? await workspaces.getWithModelCatalog(resource.projectId)
      : workspaces.get(resource.projectId)
    if (resource.kind === 'workspace') return { workspace }
    if (resource.kind === 'conversation') {
      if (workspace.conversation.id !== resource.conversationId) {
        throw new ApplicationError('not_found', 'Conversation not found')
      }
      return { conversation: workspace.conversation }
    }
    const run = workspace.taskRuns.find((candidate) => candidate.id === resource.runId)
    if (!run) throw new ApplicationError('not_found', 'Run not found')
    return { run, detail: database?.orchestration.getRunDetail(resource.runId) }
  }

  async function subscribeStream(
    socket: WebSocket,
    deviceId: string,
    input: { subscriptionId: string; resource: StreamResource; afterCursor: number },
  ): Promise<{ cursor: number; resynchronized: boolean }> {
    if (!database) throw new ApplicationError('unavailable', 'Stream service is unavailable')
    const current = streamCursor(input.resource)
    const oldest = Math.max(0, current - 500)
    const initial = input.afterCursor === 0
    const resynchronized = !initial && (input.afterCursor < oldest || input.afterCursor > current)
    const reason = input.afterCursor === 0 ? 'initial' : 'cursor_gap'
    if (initial || resynchronized) {
      sendStream(socket, {
        type: 'stream.snapshot',
        subscriptionId: input.subscriptionId,
        resource: input.resource,
        cursor: current,
        resynchronized,
        reason,
        data: await streamData(input.resource, true),
      })
    } else if (input.resource.kind === 'conversation') {
      for (const event of database.conversations.streamEventsAfter(
        input.resource.conversationId,
        input.afterCursor,
        500,
      )) {
        if (
          !sendStream(socket, {
            type: 'stream.delta',
            subscriptionId: input.subscriptionId,
            resource: input.resource,
            cursor: event.sequence,
            eventId: event.eventId,
            eventType: event.type,
            data: { event: event.payload, ...((await streamData(input.resource)) as object) },
            occurredAt: event.occurredAt,
          })
        )
          break
      }
    } else if (input.resource.kind === 'run') {
      for (const event of database.orchestration.runEventsAfter(
        input.resource.runId,
        input.afterCursor,
        500,
      )) {
        if (
          !sendStream(socket, {
            type: 'stream.delta',
            subscriptionId: input.subscriptionId,
            resource: input.resource,
            cursor: event.cursor,
            eventId: event.eventId,
            eventType: event.type,
            data: event.data,
            occurredAt: event.occurredAt,
          })
        )
          break
      }
    } else {
      for (const event of database.eventsAfter(input.afterCursor, 500)) {
        const relevant =
          input.resource.kind === 'shell' || event.aggregateId === input.resource.projectId
        if (!relevant) continue
        if (
          !sendStream(socket, {
            type: 'stream.delta',
            subscriptionId: input.subscriptionId,
            resource: input.resource,
            cursor: event.sequence,
            eventId: event.eventId,
            eventType: event.type,
            data: { event: event.payload, ...((await streamData(input.resource)) as object) },
            occurredAt: event.occurredAt,
          })
        )
          break
      }
    }
    const subscriptions = streamSubscribers.get(socket) ?? new Map()
    subscriptions.set(input.subscriptionId, { deviceId, resource: input.resource, cursor: current })
    streamSubscribers.set(socket, subscriptions)
    sendStream(socket, {
      type: 'stream.live',
      subscriptionId: input.subscriptionId,
      resource: input.resource,
      cursor: current,
    })
    return { cursor: current, resynchronized }
  }

  async function publishScopedEvents(): Promise<void> {
    if (!database || !projects) return
    for (const [socket, subscriptions] of streamSubscribers) {
      for (const [subscriptionId, subscription] of subscriptions) {
        const current = streamCursor(subscription.resource)
        if (current <= subscription.cursor) continue
        const resource = subscription.resource
        if (resource.kind === 'conversation') {
          const events = database.conversations.streamEventsAfter(
            resource.conversationId,
            subscription.cursor,
            501,
          )
          if (events.length > 500) {
            await subscribeStream(socket, subscription.deviceId, {
              subscriptionId,
              resource,
              afterCursor: 0,
            })
            continue
          }
          for (const event of events) {
            if (
              !sendStream(socket, {
                type: 'stream.delta',
                subscriptionId,
                resource,
                cursor: event.sequence,
                eventId: event.eventId,
                eventType: event.type,
                data: { event: event.payload, ...((await streamData(resource)) as object) },
                occurredAt: event.occurredAt,
              })
            )
              break
          }
        } else if (resource.kind === 'run') {
          const events = database.orchestration.runEventsAfter(
            resource.runId,
            subscription.cursor,
            501,
          )
          if (events.length > 500) {
            await subscribeStream(socket, subscription.deviceId, {
              subscriptionId,
              resource,
              afterCursor: 0,
            })
            continue
          }
          for (const event of events) {
            if (
              !sendStream(socket, {
                type: 'stream.delta',
                subscriptionId,
                resource,
                cursor: event.cursor,
                eventId: event.eventId,
                eventType: event.type,
                data: event.data,
                occurredAt: event.occurredAt,
              })
            )
              break
          }
        } else {
          const events = database.eventsAfter(subscription.cursor, 501)
          if (events.length > 500) {
            await subscribeStream(socket, subscription.deviceId, {
              subscriptionId,
              resource,
              afterCursor: 0,
            })
            continue
          }
          for (const event of events) {
            if (resource.kind !== 'shell' && event.aggregateId !== resource.projectId) continue
            if (
              !sendStream(socket, {
                type: 'stream.delta',
                subscriptionId,
                resource,
                cursor: event.sequence,
                eventId: event.eventId,
                eventType: event.type,
                data: { event: event.payload, ...((await streamData(resource)) as object) },
                occurredAt: event.occurredAt,
              })
            )
              break
          }
        }
        subscription.cursor = current
      }
    }
  }

  app.get(HEALTH_PATH, async (_request, reply) => reply.code(200).send(currentHealth()))

  if (database) {
    app.post(GAS_CITY_CALLBACK_PATH, async (request, reply) => {
      if (!isLoopbackIp(request.ip) || !request.headers['x-gc-request']) {
        return reply.code(403).send(problem('forbidden', 'Gas City callbacks are host-local'))
      }
      const parsed = gasCityOutboundCallbackSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply
          .code(400)
          .send(problem('invalid_request', 'Invalid Gas City callback', parsed.error.issues))
      }
      const conversation = database.product.getConversationById(
        parsed.data.conversation.conversation_id,
      )
      const project = conversation ? database.getProject(conversation.projectId) : null
      if (
        !conversation ||
        !project ||
        parsed.data.conversation.account_id !== conversation.gasCityAccountId ||
        parsed.data.conversation.conversation_id !== conversation.gasCityConversationId ||
        parsed.data.conversation.scope_id !== project.rig.rigName
      ) {
        return reply.code(404).send(problem('not_found', 'Factoru conversation not found'))
      }
      return reply.code(200).send({
        message_id: gasCityCallbackMessageId(parsed.data),
        conversation: parsed.data.conversation,
        delivered: true,
        failure_kind: '',
        retry_after: 0,
        metadata: {},
      })
    })
  }

  if (agentTools) {
    app.post(AGENT_TOOL_SESSION_PATH, async (request, reply) => {
      if (!isLoopbackIp(request.ip)) {
        return reply.code(403).send(problem('forbidden', 'Agent sessions are host-local'))
      }
      const parsed = agentToolSessionRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply
          .code(400)
          .send(problem('invalid_request', 'Invalid agent session request', parsed.error.issues))
      }
      try {
        return reply.code(201).send(agentTools.createSession(parsed.data))
      } catch (error) {
        return reply
          .code(403)
          .send(problem('forbidden', error instanceof Error ? error.message : String(error)))
      }
    })

    app.post(AGENT_TOOL_CALL_PATH, async (request, reply) => {
      if (!isLoopbackIp(request.ip)) {
        return reply.code(403).send(problem('forbidden', 'Agent tools are host-local'))
      }
      const authorization = request.headers.authorization ?? ''
      const rawToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
      const parsed = agentToolCallRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply
          .code(400)
          .send(problem('invalid_request', 'Invalid agent tool call', parsed.error.issues))
      }
      const response = agentTools.call(rawToken, parsed.data)
      return reply
        .code(response.ok ? 200 : response.error?.code === 'unauthorized' ? 401 : 400)
        .send(response)
    })
  }

  app.post(HANDSHAKE_PATH, async (request, reply) => {
    const parsed = handshakeRequestSchema.safeParse(request.body)
    if (!parsed.success)
      return reply
        .code(400)
        .send(problem('invalid_request', 'Invalid handshake request', parsed.error.issues))
    const server = descriptorFromHealth(currentHealth())
    const result = checkCompatibility(parsed.data, server)
    request.log.info(
      { clientName: parsed.data.clientName, compatible: result.compatible },
      'handshake',
    )
    return reply.code(200).send(
      handshakeResponseSchema.parse({
        server,
        compatible: result.compatible,
        negotiatedProtocolVersion: result.negotiatedProtocolVersion,
        incompatibility: result.incompatibility,
      }),
    )
  })

  if (database && projects) {
    if (artifacts) {
      const artifactPath = '/api/v1/projects/:projectId/conversations/:conversationId/artifacts'
      app.post(artifactPath, async (request, reply) => {
        const device = bearerDevice(database, request.headers.authorization)
        if (!device)
          return reply
            .code(401)
            .send(problem('unauthorized', 'Device credential is invalid or revoked'))
        try {
          requireScope(device, 'projects:write')
          const params = request.params as { projectId: string; conversationId: string }
          const provenance = request.headers['x-artifact-provenance']
          if (!['picker', 'paste', 'drop'].includes(String(provenance))) {
            return reply.code(400).send(problem('invalid_request', 'Image provenance is required'))
          }
          if (!Buffer.isBuffer(request.body)) {
            return reply.code(400).send(problem('invalid_request', 'Image body must be binary'))
          }
          const artifact = artifacts.upload({
            projectId: params.projectId,
            conversationId: params.conversationId,
            deviceId: device.id,
            fileName: (() => {
              try {
                return decodeURIComponent(String(request.headers['x-file-name'] ?? 'image'))
              } catch {
                throw new ApplicationError('invalid_file_name', 'Image file name is invalid')
              }
            })(),
            mimeType: String(request.headers['content-type'] ?? ''),
            provenance: provenance as 'picker' | 'paste' | 'drop',
            bytes: request.body,
          })
          return reply.code(201).send(artifactSchema.parse(artifact))
        } catch (error) {
          if (error instanceof ApplicationError) {
            return reply
              .code(error.code === 'not_found' ? 404 : 400)
              .send(
                problem(
                  error.code === 'not_found' ? 'not_found' : 'invalid_request',
                  error.message,
                  { code: error.code },
                ),
              )
          }
          if (error instanceof Error && error.message === 'forbidden') {
            return reply
              .code(403)
              .send(problem('forbidden', 'Device is not authorized for this operation'))
          }
          throw error
        }
      })
      app.get(`${artifactPath}/:artifactId`, async (request, reply) => {
        const device = bearerDevice(database, request.headers.authorization)
        if (!device)
          return reply
            .code(401)
            .send(problem('unauthorized', 'Device credential is invalid or revoked'))
        try {
          requireScope(device, 'projects:read')
          const params = request.params as {
            projectId: string
            conversationId: string
            artifactId: string
          }
          const result = artifacts.readScoped(
            params.projectId,
            params.conversationId,
            params.artifactId,
          )
          return reply
            .header('content-type', result.artifact.mimeType)
            .header('cache-control', 'private, max-age=300')
            .header('x-content-type-options', 'nosniff')
            .send(result.bytes)
        } catch (error) {
          if (error instanceof ApplicationError)
            return reply.code(404).send(problem('not_found', error.message))
          if (error instanceof Error && error.message === 'forbidden') {
            return reply
              .code(403)
              .send(problem('forbidden', 'Device is not authorized for this operation'))
          }
          throw error
        }
      })
      app.delete(`${artifactPath}/:artifactId`, async (request, reply) => {
        const device = bearerDevice(database, request.headers.authorization)
        if (!device)
          return reply
            .code(401)
            .send(problem('unauthorized', 'Device credential is invalid or revoked'))
        try {
          requireScope(device, 'projects:write')
          const params = request.params as {
            projectId: string
            conversationId: string
            artifactId: string
          }
          artifacts.remove(params.projectId, params.conversationId, params.artifactId)
          return reply.code(204).send()
        } catch (error) {
          if (error instanceof ApplicationError) {
            return reply
              .code(error.code === 'artifact_in_use' ? 409 : 404)
              .send(
                problem(
                  error.code === 'artifact_in_use' ? 'invalid_request' : 'not_found',
                  error.message,
                  { code: error.code },
                ),
              )
          }
          if (error instanceof Error && error.message === 'forbidden') {
            return reply
              .code(403)
              .send(problem('forbidden', 'Device is not authorized for this operation'))
          }
          throw error
        }
      })
      app.get('/internal/v1/artifacts/:artifactId', async (request, reply) => {
        if (!isLoopbackIp(request.ip)) {
          return reply.code(403).send(problem('forbidden', 'Artifact grants are host-local'))
        }
        const params = request.params as { artifactId: string }
        const query = request.query as { token?: string }
        if (!query.token)
          return reply.code(401).send(problem('unauthorized', 'Artifact grant is required'))
        try {
          const result = artifacts.readWithGrant(params.artifactId, query.token)
          return reply
            .header('content-type', result.artifact.mimeType)
            .header('cache-control', 'private, no-store')
            .header('x-content-type-options', 'nosniff')
            .send(result.bytes)
        } catch (error) {
          if (error instanceof ApplicationError)
            return reply.code(404).send(problem('not_found', error.message))
          throw error
        }
      })
    }

    if (options.localEnrollmentProof) {
      app.post(LOCAL_ENROLLMENT_PATH, async (request, reply) => {
        if (!isLoopbackIp(request.ip)) {
          return reply.code(403).send(problem('forbidden', 'Local enrollment is host-local'))
        }
        const parsed = localEnrollmentRequestSchema.safeParse(request.body)
        if (!parsed.success || !equalProof(options.localEnrollmentProof!, parsed.data.proof)) {
          return reply
            .code(401)
            .send(problem('unauthorized', 'Local enrollment proof is invalid or expired'))
        }
        const issued = database.createTrustedDevice(parsed.data.deviceName)
        return reply
          .code(200)
          .send(pairingExchangeResponseSchema.parse({ serverId: options.serverId, ...issued }))
      })
    }

    app.post(PAIRING_EXCHANGE_PATH, async (request, reply) => {
      if (!protectedTransport(request))
        return reply
          .code(400)
          .send(problem('invalid_request', 'Pairing requires HTTPS outside localhost'))
      const recent = (pairingAttempts.get(request.ip) ?? []).filter(
        (time) => Date.now() - time < 60_000,
      )
      if (recent.length >= 5)
        return reply.code(429).send(problem('unavailable', 'Pairing is temporarily unavailable'))
      const parsed = pairingExchangeRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        recent.push(Date.now())
        pairingAttempts.set(request.ip, recent)
        return reply.code(401).send(problem('unauthorized', 'Invalid or expired pairing code'))
      }
      const issued = database.exchangePairingCode(parsed.data.code, parsed.data.deviceName)
      if (!issued) {
        recent.push(Date.now())
        pairingAttempts.set(request.ip, recent)
        return reply.code(401).send(problem('unauthorized', 'Invalid or expired pairing code'))
      }
      pairingAttempts.delete(request.ip)
      return reply
        .code(200)
        .send(pairingExchangeResponseSchema.parse({ serverId: options.serverId, ...issued }))
    })

    app.post(CONNECTION_TICKET_PATH, async (request, reply) => {
      if (!protectedTransport(request))
        return reply
          .code(400)
          .send(problem('invalid_request', 'Authentication requires HTTPS outside localhost'))
      const device = bearerDevice(database, request.headers.authorization)
      if (!device)
        return reply
          .code(401)
          .send(problem('unauthorized', 'Device credential is invalid or revoked'))
      return reply.code(200).send(connectionTicketResponseSchema.parse(tickets.issue(device)))
    })

    void app.register(async function liveApi(liveApp) {
      await liveApp.register(websocket)
      liveApp.get(LIVE_PATH, { websocket: true }, (socket, request) => {
        const query = request.query as { ticket?: string }
        const ticketDevice = query.ticket ? tickets.consume(query.ticket) : null
        const device = ticketDevice ? database.getActiveDevice(ticketDevice.id) : null
        if (!device) {
          socket.close(1008, 'unauthorized')
          return
        }
        activeSockets.set(socket, device.id)

        socket.on('message', (raw) => {
          let decoded: unknown
          try {
            decoded = JSON.parse(raw.toString())
          } catch {
            responseError(socket, '', 'invalid_request', 'Message must be JSON')
            return
          }
          const parsed = liveRequestSchema.safeParse(decoded)
          if (!parsed.success) {
            responseError(
              socket,
              '',
              'invalid_request',
              'Invalid live request',
              parsed.error.issues,
            )
            return
          }
          void dispatchLive(socket, device, parsed.data)
        })
        socket.on('close', () => {
          activeSockets.delete(socket)
          subscribers.delete(socket)
          streamSubscribers.delete(socket)
        })
      })
    })
  }

  async function dispatchLive(
    socket: WebSocket,
    device: TrustedDevice,
    request: LiveRequest,
  ): Promise<void> {
    if (!projects || !database)
      return responseError(socket, request.id, 'unavailable', 'Product services are unavailable')
    const currentDevice = database.getActiveDevice(device.id)
    if (!currentDevice) {
      responseError(socket, request.id, 'unauthorized', 'Device credential is invalid or revoked')
      socket.close(1008, 'revoked')
      return
    }
    const requiredScopes: Record<LiveRequest['method'], OwnerScope> = {
      'repositories.roots': 'projects:read',
      'repositories.browse': 'projects:read',
      'repositories.previewPath': 'projects:write',
      'repositories.checkRemoteAccess': 'projects:write',
      'projects.previewCreate': 'projects:write',
      'projects.list': 'projects:read',
      'projects.get': 'projects:read',
      'projects.create': 'projects:write',
      'projects.retrySetup': 'projects:write',
      'projects.subscribe': 'events:read',
      'streams.subscribe': 'events:read',
      'streams.unsubscribe': 'events:read',
      'devices.list': 'devices:read',
      'devices.revoke': 'devices:revoke',
      'workspaces.get': 'projects:read',
      'conversations.send': 'projects:write',
      'conversations.history': 'projects:read',
      'conversations.cancel': 'projects:write',
      'conversations.retry': 'projects:write',
      'conversations.resetContext': 'projects:write',
      'team.updateModelBinding': 'projects:write',
      'workers.updateModelBinding': 'projects:write',
      'projects.updateWorkflowDefault': 'projects:write',
      'memory.add': 'projects:write',
      'planner.start': 'projects:write',
      'planner.cancel': 'projects:write',
      'tasks.create': 'projects:write',
      'tasks.update': 'projects:write',
      'tasks.move': 'projects:write',
      'tasks.resolve': 'projects:write',
      'tasks.search': 'projects:read',
      'tasks.decideMerge': 'projects:write',
      'tasks.split': 'projects:write',
      'tasks.addEvidence': 'projects:write',
      'tasks.setResourceIntents': 'projects:write',
      'memory.search': 'projects:read',
      'memory.proposeUpdate': 'projects:write',
      'memory.decideProposal': 'projects:write',
      'runs.getDetail': 'projects:read',
      'runs.readArtifact': 'projects:read',
      'runs.cancel': 'projects:write',
      'runs.retry': 'projects:write',
      'runs.requestChanges': 'projects:write',
      'runs.approve': 'projects:write',
      'runs.archive': 'projects:write',
    }
    try {
      requireScope(currentDevice, requiredScopes[request.method])
      let result: unknown
      switch (request.method) {
        case 'repositories.roots':
          result = projects.repositories.roots()
          break
        case 'repositories.browse': {
          const params = repositoryBrowseParamsSchema.parse(request.params)
          result = await projects.repositories.browse(params.rootId, params.relativePath)
          break
        }
        case 'repositories.previewPath': {
          const params = repositoryPreviewPathParamsSchema.parse(request.params)
          result = await projects.repositories.previewAbsolute(params.absolutePath)
          break
        }
        case 'repositories.checkRemoteAccess': {
          const params = repositoryAccessCheckParamsSchema.parse(request.params)
          result = await projects.repositories.checkRemoteAccess(params.url)
          break
        }
        case 'projects.previewCreate': {
          const params = projectPreviewParamsSchema.parse(request.params)
          result = (
            await projects.repositories.preview(
              params.rootId,
              params.relativePath,
              params.defaultBranch,
            )
          ).preview
          break
        }
        case 'projects.list':
          result = projects.listProjects()
          break
        case 'projects.get':
          result = projects.getProject(projectIdParamsSchema.parse(request.params).projectId)
          break
        case 'projects.create': {
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Project creation requires commandId')
          result = await projects.createProject(
            currentDevice,
            request.commandId,
            projectCreateParamsSchema.parse(request.params),
          )
          break
        }
        case 'projects.retrySetup': {
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Setup retry requires commandId')
          result = await projects.retrySetup(
            currentDevice,
            request.commandId,
            projectIdParamsSchema.parse(request.params).projectId,
          )
          break
        }
        case 'projects.subscribe': {
          const { afterCursor } = projectSubscribeParamsSchema.parse(request.params)
          result = projectSnapshotSchema.parse(projects.snapshot(afterCursor))
          subscribers.set(socket, {
            deviceId: device.id,
            cursor: (result as { cursor: number }).cursor,
          })
          break
        }
        case 'streams.subscribe': {
          const params = streamSubscribeParamsSchema.parse(request.params)
          result = await subscribeStream(socket, currentDevice.id, params)
          break
        }
        case 'streams.unsubscribe': {
          const params = streamUnsubscribeParamsSchema.parse(request.params)
          result = {
            removed: streamSubscribers.get(socket)?.delete(params.subscriptionId) ?? false,
          }
          break
        }
        case 'devices.list':
          result = database.listDevices()
          break
        case 'devices.revoke': {
          const { deviceId, confirmSelf } = deviceRevokeParamsSchema.parse(request.params)
          if (deviceId === currentDevice.id && !confirmSelf) {
            throw new ApplicationError(
              'confirmation_required',
              'Confirm self-revocation before removing this device',
            )
          }
          result = { revoked: database.revokeDevice(deviceId), self: deviceId === currentDevice.id }
          for (const [active, activeDeviceId] of activeSockets) {
            if (activeDeviceId === deviceId && active !== socket) active.close(1008, 'revoked')
          }
          break
        }
        case 'workspaces.get': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          result = await workspaces.getWithModelCatalog(
            projectIdParamsSchema.parse(request.params).projectId,
          )
          break
        }
        case 'conversations.send': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = conversationSendParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Sending a message requires commandId',
            )
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () =>
              workspaces.sendMessage(
                params.projectId,
                params.text,
                params.artifactIds,
                currentDevice.name,
              ),
          )
          break
        }
        case 'conversations.history': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = conversationHistoryParamsSchema.parse(request.params)
          result = workspaces.conversationHistory(
            params.projectId,
            params.conversationId,
            params.before,
            params.limit,
            params.contextRevision,
          )
          break
        }
        case 'conversations.cancel': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = conversationCancelParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Cancelling a response requires commandId',
            )
          const replay = database.replayCommand(request.commandId, request.method, params)
          result =
            replay ??
            database.recordCommand(
              request.commandId,
              currentDevice.id,
              request.method,
              params,
              await workspaces.cancelConversation(
                params.projectId,
                params.conversationId,
                params.turnId,
              ),
            )
          break
        }
        case 'conversations.retry': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = conversationRetryParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Retrying a response requires commandId',
            )
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () =>
              workspaces.retryConversation(
                params.projectId,
                params.conversationId,
                params.messageId,
                currentDevice.name,
              ),
          )
          break
        }
        case 'conversations.resetContext': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = conversationResetContextParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Starting a fresh context requires commandId',
            )
          const replay = database.replayCommand(request.commandId, request.method, params)
          result =
            replay ??
            database.recordCommand(
              request.commandId,
              currentDevice.id,
              request.method,
              params,
              await workspaces.resetConversationContext(params.projectId, params.conversationId),
            )
          break
        }
        case 'team.updateModelBinding':
        case 'workers.updateModelBinding': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = modelBindingUpdateParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Updating a model binding requires commandId',
            )
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => workspaces.updateModelBinding(params),
          )
          break
        }
        case 'projects.updateWorkflowDefault': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = projectWorkflowDefaultUpdateParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Updating the project workflow default requires commandId',
            )
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () =>
              workspaces.updateProjectWorkflowDefault(params.projectId, params.workflowPresetId),
          )
          break
        }
        case 'memory.add': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = memoryAddParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Adding memory requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => workspaces.addMemory(params),
          )
          break
        }
        case 'planner.start': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = projectIdParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Starting a planner requires commandId',
            )
          const replay = database.replayCommand(request.commandId, request.method, params)
          result =
            replay ??
            database.recordCommand(
              request.commandId,
              currentDevice.id,
              request.method,
              params,
              await workspaces.startPlannerProbe(params.projectId),
            )
          break
        }
        case 'planner.cancel': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = plannerCancelParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Cancelling a planner requires commandId',
            )
          const replay = database.replayCommand(request.commandId, request.method, params)
          result =
            replay ??
            database.recordCommand(
              request.commandId,
              currentDevice.id,
              request.method,
              params,
              await workspaces.cancelPlannerProbe(params.projectId, params.plannerProbeId),
            )
          break
        }
        case 'tasks.create': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = taskCreateParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Creating a task requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => tasks.create(params, currentDevice.id),
          )
          break
        }
        case 'tasks.update': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = taskUpdateParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Updating a task requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => tasks.update(params, currentDevice.id),
          )
          break
        }
        case 'tasks.move': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = taskMoveParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Moving a task requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => tasks.move(params, currentDevice.id),
          )
          break
        }
        case 'tasks.resolve': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = taskResolveParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Resolving a task requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => tasks.resolve(params, currentDevice.id),
          )
          break
        }
        case 'tasks.search': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = taskSearchParamsSchema.parse(request.params)
          result = tasks.search(params.projectId, params.query, params.limit)
          break
        }
        case 'tasks.decideMerge': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = taskMergeDecisionParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Deciding a merge requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => tasks.decideMerge(params, currentDevice.id),
          )
          break
        }
        case 'tasks.split': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = taskSplitParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Splitting a task requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => tasks.split(params, currentDevice.id),
          )
          break
        }
        case 'tasks.addEvidence': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = taskEvidenceParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Adding evidence requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => tasks.addEvidence(params),
          )
          break
        }
        case 'tasks.setResourceIntents': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = taskResourceIntentsParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Setting resources requires commandId',
            )
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => tasks.setResourceIntents(params),
          )
          break
        }
        case 'memory.search': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = memorySearchParamsSchema.parse(request.params)
          result = tasks.searchMemory(
            params.projectId,
            params.query,
            params.workerTypeKind,
            params.limit,
          )
          break
        }
        case 'memory.proposeUpdate': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = memoryProposeUpdateParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Proposing memory requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () =>
              tasks.proposeMemory(
                { ...params, workerTypeKind: params.workerTypeKind ?? undefined },
                currentDevice.id,
              ),
          )
          break
        }
        case 'memory.decideProposal': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = memoryDecideProposalParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Deciding memory requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => tasks.decideMemory(params.projectId, params.proposalId, params.decision),
          )
          break
        }
        case 'runs.getDetail': {
          if (!tasks) throw new ApplicationError('unavailable', 'Task service is unavailable')
          const params = runDetailParamsSchema.parse(request.params)
          result = tasks.runDetail(params.projectId, params.runId)
          break
        }
        case 'runs.readArtifact': {
          const params = runArtifactReadParamsSchema.parse(request.params)
          const artifact = database.orchestration.readArtifact(
            params.projectId,
            params.runId,
            params.artifactId,
          )
          result = {
            mediaType: artifact.mediaType,
            contentBase64: artifact.content.toString('base64'),
          }
          break
        }
        case 'runs.cancel': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = executionRunParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Cancelling a run requires commandId')
          const replay = database.replayCommand(request.commandId, request.method, params)
          result =
            replay ??
            database.recordCommand(
              request.commandId,
              currentDevice.id,
              request.method,
              params,
              await workspaces.cancelExecution(params.projectId, params.runId),
            )
          break
        }
        case 'runs.retry': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = executionRunParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Retrying a run requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => workspaces.retryExecution(params.projectId, params.runId),
          )
          break
        }
        case 'runs.requestChanges': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = executionRequestChangesParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError(
              'command_id_required',
              'Requesting changes requires commandId',
            )
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () =>
              workspaces.requestExecutionChanges(params.projectId, params.runId, params.feedback),
          )
          break
        }
        case 'runs.approve': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = executionApproveParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Approving a run requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () =>
              workspaces.approveExecution(
                params.projectId,
                params.runId,
                params.summary,
                currentDevice.id,
              ),
          )
          break
        }
        case 'runs.archive': {
          if (!workspaces)
            throw new ApplicationError('unavailable', 'Workspace service is unavailable')
          const params = executionRunParamsSchema.parse(request.params)
          if (!request.commandId)
            throw new ApplicationError('command_id_required', 'Archiving a run requires commandId')
          result = database.executeCommand(
            request.commandId,
            currentDevice.id,
            request.method,
            params,
            () => workspaces.archiveExecution(params.projectId, params.runId),
          )
          break
        }
      }
      socket.send(JSON.stringify({ id: request.id, ok: true, result }))
      if (request.method === 'devices.revoke' && (result as { self?: boolean }).self === true) {
        setTimeout(() => socket.close(1008, 'revoked'), 0)
      }
      if (
        request.method === 'projects.create' ||
        request.method === 'projects.retrySetup' ||
        request.method === 'conversations.send' ||
        request.method === 'conversations.cancel' ||
        request.method === 'conversations.retry' ||
        request.method === 'team.updateModelBinding' ||
        request.method === 'workers.updateModelBinding' ||
        request.method === 'projects.updateWorkflowDefault' ||
        request.method === 'memory.add' ||
        request.method === 'planner.start' ||
        request.method === 'planner.cancel' ||
        request.method === 'tasks.create' ||
        request.method === 'tasks.update' ||
        request.method === 'tasks.move' ||
        request.method === 'tasks.resolve' ||
        request.method === 'tasks.decideMerge' ||
        request.method === 'tasks.split' ||
        request.method === 'tasks.addEvidence' ||
        request.method === 'tasks.setResourceIntents' ||
        request.method === 'memory.proposeUpdate' ||
        request.method === 'memory.decideProposal' ||
        request.method === 'runs.cancel' ||
        request.method === 'runs.retry' ||
        request.method === 'runs.requestChanges' ||
        request.method === 'runs.approve' ||
        request.method === 'runs.archive'
      )
        publishEvents()
      await publishScopedEvents()
    } catch (error) {
      if (error instanceof ApplicationError || error instanceof RepositoryError) {
        return responseError(
          socket,
          request.id,
          error.code,
          error.message,
          error instanceof ApplicationError ? error.details : undefined,
        )
      }
      if (error instanceof Error && error.message === 'forbidden')
        return responseError(
          socket,
          request.id,
          'forbidden',
          'Device is not authorized for this operation',
        )
      if (error instanceof Error && error.message === 'command_id_conflict')
        return responseError(
          socket,
          request.id,
          'command_id_conflict',
          'The command id was already used for a different operation',
        )
      const message = error instanceof Error ? error.message : String(error)
      app.log.error({ err: error, method: request.method }, 'live request failed')
      void message
      responseError(
        socket,
        request.id,
        'internal_error',
        'Factoru Server failed to handle the request',
      )
    }
  }

  let outboxTimer: ReturnType<typeof setInterval> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let processingOutbox = false
  app.addHook('onReady', async () => {
    workspaces?.start()
    if (!projects) return
    const process = async () => {
      if (processingOutbox) return
      processingOutbox = true
      try {
        await projects.processOutbox()
        await workspaces?.process()
        publishEvents()
        await publishScopedEvents()
        artifacts?.cleanup()
      } catch (error) {
        app.log.error({ err: error }, 'background reactor pass failed')
      } finally {
        processingOutbox = false
      }
    }
    setTimeout(() => void process(), 0)
    outboxTimer = setInterval(() => void process(), 1_000)
    outboxTimer.unref()
    heartbeatTimer = setInterval(() => {
      const heartbeat = { type: 'stream.heartbeat', serverTime: now().toISOString() }
      for (const socket of streamSubscribers.keys()) sendStream(socket, heartbeat)
    }, 15_000)
    heartbeatTimer.unref()
  })
  app.addHook('onClose', async () => {
    if (outboxTimer) clearInterval(outboxTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    const shutdownErrors: unknown[] = []
    try {
      await workspaces?.stop()
    } catch (error) {
      shutdownErrors.push(error)
    }
    try {
      await options.runtimeLifecycle?.stop()
    } catch (error) {
      shutdownErrors.push(error)
    }
    if (shutdownErrors.length === 1) throw shutdownErrors[0]
    if (shutdownErrors.length > 1) {
      throw new AggregateError(shutdownErrors, 'Factoru Server shutdown failed')
    }
  })

  app.setNotFoundHandler(async (request, reply) =>
    reply
      .code(404)
      .send(problem('not_found', `No Factoru operation at ${request.method} ${request.url}`)),
  )
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled request error')
      return reply
        .code(500)
        .send(problem('internal_error', 'Factoru Server failed to handle the request'))
    }
    return reply.code(status).send(problem('invalid_request', error.message))
  })
  return app
}
