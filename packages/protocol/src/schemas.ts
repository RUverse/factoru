import { z } from 'zod'

/**
 * Wire format for a Factoru Server identity. The protocol package deliberately
 * owns this pattern instead of importing `packages/domain`, so that the wire
 * contract stays independent of internal value objects. The server converts a
 * validated wire value into a domain `ServerId` at its boundary.
 */
export const SERVER_ID_PATTERN = /^srv_[0-9a-f]{32}$/

export const serverIdSchema = z.string().regex(SERVER_ID_PATTERN, 'invalid server id')

export const protocolVersionSchema = z.number().int().min(1).max(1_000_000)

export const healthStatusSchema = z.enum(['ok', 'degraded', 'starting'])
export type HealthStatus = z.infer<typeof healthStatusSchema>

/** The compatibility half of every server response. */
export const serverDescriptorSchema = z
  .object({
    serverId: serverIdSchema,
    serverVersion: z.string().min(1),
    protocolVersion: protocolVersionSchema,
    minProtocolVersion: protocolVersionSchema,
    capabilities: z.array(z.string().min(1)),
  })
  .refine((value) => value.minProtocolVersion <= value.protocolVersion, {
    message: 'minProtocolVersion must not exceed protocolVersion',
    path: ['minProtocolVersion'],
  })

export type ServerDescriptor = z.infer<typeof serverDescriptorSchema>

export const healthResponseSchema = z
  .object({
    status: healthStatusSchema,
    serverId: serverIdSchema,
    serverVersion: z.string().min(1),
    protocolVersion: protocolVersionSchema,
    minProtocolVersion: protocolVersionSchema,
    capabilities: z.array(z.string().min(1)),
    startedAt: z.iso.datetime(),
    uptimeMs: z.number().int().nonnegative(),
  })
  .refine((value) => value.minProtocolVersion <= value.protocolVersion, {
    message: 'minProtocolVersion must not exceed protocolVersion',
    path: ['minProtocolVersion'],
  })

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const handshakeRequestSchema = z
  .object({
    clientName: z.string().min(1).max(64),
    clientVersion: z.string().min(1).max(64),
    protocolVersion: protocolVersionSchema,
    minProtocolVersion: protocolVersionSchema,
  })
  .refine((value) => value.minProtocolVersion <= value.protocolVersion, {
    message: 'minProtocolVersion must not exceed protocolVersion',
    path: ['minProtocolVersion'],
  })

export type HandshakeRequest = z.infer<typeof handshakeRequestSchema>

export const incompatibilitySchema = z.object({
  code: z.enum(['server_too_old', 'client_too_old']),
  message: z.string().min(1),
})

export type Incompatibility = z.infer<typeof incompatibilitySchema>

export const handshakeResponseSchema = z.object({
  server: serverDescriptorSchema,
  compatible: z.boolean(),
  negotiatedProtocolVersion: protocolVersionSchema.nullable(),
  incompatibility: incompatibilitySchema.nullable(),
})

export type HandshakeResponse = z.infer<typeof handshakeResponseSchema>

/** Health carries a descriptor; this keeps the two views in one place. */
export function descriptorFromHealth(health: HealthResponse): ServerDescriptor {
  return {
    serverId: health.serverId,
    serverVersion: health.serverVersion,
    protocolVersion: health.protocolVersion,
    minProtocolVersion: health.minProtocolVersion,
    capabilities: health.capabilities,
  }
}
