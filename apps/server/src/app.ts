import Fastify, { LogController, type FastifyError, type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import type { ServerId } from '@factoru/domain'
import type { FactoruDatabase, OwnerScope, TrustedDevice } from '@factoru/database'
import {
  CAPABILITY_HANDSHAKE,
  CAPABILITY_HEALTH,
  CAPABILITY_LIVE,
  CAPABILITY_PAIRING,
  CAPABILITY_PROJECTS,
  CAPABILITY_TRUSTED_DEVICES,
  CAPABILITY_CONVERSATIONS,
  CAPABILITY_WORKSPACES,
  CAPABILITY_WORKER_TYPES,
  CAPABILITY_TASKS,
  CAPABILITY_QUEUE_RECONCILIATION,
  CONNECTION_TICKET_PATH,
  HANDSHAKE_PATH,
  HEALTH_PATH,
  LIVE_PATH,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PAIRING_EXCHANGE_PATH,
  PROTOCOL_VERSION,
  checkCompatibility,
  connectionTicketResponseSchema,
  descriptorFromHealth,
  deviceRevokeParamsSchema,
  conversationSendParamsSchema,
  handshakeRequestSchema,
  handshakeResponseSchema,
  healthResponseSchema,
  liveRequestSchema,
  memoryAddParamsSchema,
  modelBindingUpdateParamsSchema,
  pairingExchangeRequestSchema,
  pairingExchangeResponseSchema,
  problem,
  projectCreateParamsSchema,
  projectIdParamsSchema,
  projectPreviewParamsSchema,
  projectSnapshotSchema,
  projectSubscribeParamsSchema,
  plannerCancelParamsSchema,
  repositoryBrowseParamsSchema,
  type HealthResponse,
  type LiveRequest,
  taskCreateParamsSchema,
  taskMoveParamsSchema,
  taskResolveParamsSchema,
  taskSearchParamsSchema,
  taskUpdateParamsSchema,
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
}

export const BASE_SERVER_CAPABILITIES = [CAPABILITY_HEALTH, CAPABILITY_HANDSHAKE]

function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '0:0:0:0:0:0:0:1'
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
  const capabilities =
    projects && database
      ? [
          ...BASE_SERVER_CAPABILITIES,
          CAPABILITY_PAIRING,
          CAPABILITY_LIVE,
          CAPABILITY_PROJECTS,
          CAPABILITY_TRUSTED_DEVICES,
          ...(workspaces
            ? [CAPABILITY_WORKSPACES, CAPABILITY_CONVERSATIONS, CAPABILITY_WORKER_TYPES]
            : []),
          ...(tasks ? [CAPABILITY_TASKS, CAPABILITY_QUEUE_RECONCILIATION] : []),
        ]
      : BASE_SERVER_CAPABILITIES
  const tickets = new TicketStore()
  const subscribers = new Map<WebSocket, { deviceId: string; cursor: number }>()
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
    bodyLimit: 64 * 1024,
    trustProxy: options.trustProxy === true ? ['127.0.0.1', '::1'] : false,
  })

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

  app.get(HEALTH_PATH, async (_request, reply) => reply.code(200).send(currentHealth()))

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
      'projects.previewCreate': 'projects:write',
      'projects.list': 'projects:read',
      'projects.get': 'projects:read',
      'projects.create': 'projects:write',
      'projects.retrySetup': 'projects:write',
      'projects.subscribe': 'events:read',
      'devices.list': 'devices:read',
      'devices.revoke': 'devices:revoke',
      'workspaces.get': 'projects:read',
      'conversations.send': 'projects:write',
      'workers.updateModelBinding': 'projects:write',
      'memory.add': 'projects:write',
      'planner.start': 'projects:write',
      'planner.cancel': 'projects:write',
      'tasks.create': 'projects:write',
      'tasks.update': 'projects:write',
      'tasks.move': 'projects:write',
      'tasks.resolve': 'projects:write',
      'tasks.search': 'projects:read',
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
          result = projects.retrySetup(
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
          result = workspaces.get(projectIdParamsSchema.parse(request.params).projectId)
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
            () => workspaces.sendMessage(params.projectId, params.text, currentDevice.name),
          )
          break
        }
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
      }
      socket.send(JSON.stringify({ id: request.id, ok: true, result }))
      if (request.method === 'devices.revoke' && (result as { self?: boolean }).self === true) {
        setTimeout(() => socket.close(1008, 'revoked'), 0)
      }
      if (
        request.method === 'projects.create' ||
        request.method === 'projects.retrySetup' ||
        request.method === 'conversations.send' ||
        request.method === 'workers.updateModelBinding' ||
        request.method === 'memory.add' ||
        request.method === 'planner.start' ||
        request.method === 'planner.cancel' ||
        request.method === 'tasks.create' ||
        request.method === 'tasks.update' ||
        request.method === 'tasks.move' ||
        request.method === 'tasks.resolve'
      )
        publishEvents()
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
  let processingOutbox = false
  app.addHook('onReady', async () => {
    if (!projects) return
    const process = async () => {
      if (processingOutbox) return
      processingOutbox = true
      try {
        await projects.processOutbox()
        await workspaces?.process()
        publishEvents()
      } catch (error) {
        app.log.error({ err: error }, 'background reactor pass failed')
      } finally {
        processingOutbox = false
      }
    }
    setTimeout(() => void process(), 0)
    outboxTimer = setInterval(() => void process(), 1_000)
    outboxTimer.unref()
  })
  app.addHook('onClose', async () => {
    if (outboxTimer) clearInterval(outboxTimer)
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
