import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import type { ServerId } from '@factoru/domain'
import {
  CAPABILITY_HANDSHAKE,
  CAPABILITY_HEALTH,
  HANDSHAKE_PATH,
  HEALTH_PATH,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  checkCompatibility,
  descriptorFromHealth,
  handshakeRequestSchema,
  handshakeResponseSchema,
  healthResponseSchema,
  problem,
  type HealthResponse,
} from '@factoru/protocol'
import type { ServerConfig } from './config.js'
import { SERVER_VERSION } from './version.js'

export interface BuildServerOptions {
  serverId: ServerId
  /** Application version reported to clients. Defaults to this build's version. */
  version?: string
  logLevel?: ServerConfig['logLevel']
  /** Injected for deterministic uptime in tests. */
  startedAt?: Date
  now?: () => Date
}

export const SERVER_CAPABILITIES = [CAPABILITY_HEALTH, CAPABILITY_HANDSHAKE]

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const version = options.version ?? SERVER_VERSION
  const startedAt = options.startedAt ?? new Date()
  const now = options.now ?? (() => new Date())

  const app = Fastify({
    logger: options.logLevel === 'silent' ? false : { level: options.logLevel ?? 'info' },
    // Untrusted clients must not be able to grow request handling costs.
    bodyLimit: 64 * 1024,
  })

  function currentHealth(): HealthResponse {
    const health: HealthResponse = {
      status: 'ok',
      serverId: options.serverId,
      serverVersion: version,
      protocolVersion: PROTOCOL_VERSION,
      minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
      capabilities: SERVER_CAPABILITIES,
      startedAt: startedAt.toISOString(),
      uptimeMs: Math.max(0, now().getTime() - startedAt.getTime()),
    }
    // Parsing outgoing payloads keeps the server from ever emitting something
    // the shared protocol schema would reject on the client.
    return healthResponseSchema.parse(health)
  }

  app.get(HEALTH_PATH, async (_request, reply) => {
    return reply.code(200).send(currentHealth())
  })

  app.post(HANDSHAKE_PATH, async (request, reply) => {
    const parsed = handshakeRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply
        .code(400)
        .send(problem('invalid_request', 'Invalid handshake request', parsed.error.issues))
    }

    const server = descriptorFromHealth(currentHealth())
    const result = checkCompatibility(parsed.data, server)

    request.log.info(
      {
        clientName: parsed.data.clientName,
        clientVersion: parsed.data.clientVersion,
        clientProtocolVersion: parsed.data.protocolVersion,
        compatible: result.compatible,
      },
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

  app.setNotFoundHandler(async (request, reply) => {
    return reply
      .code(404)
      .send(problem('not_found', `No Factoru operation at ${request.method} ${request.url}`))
  })

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled request error')
      // Internal detail never crosses the boundary; the log keeps it.
      return reply
        .code(500)
        .send(problem('internal_error', 'Factoru Server failed to handle the request'))
    }
    return reply.code(status).send(problem('invalid_request', error.message))
  })

  return app
}
