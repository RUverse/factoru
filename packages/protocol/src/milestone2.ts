import { z } from 'zod'
import { serverIdSchema } from './schemas.js'

export const CAPABILITY_PAIRING = 'pairing-v1'
export const CAPABILITY_LOCAL_ENROLLMENT = 'local-enrollment-v1'
export const CAPABILITY_LIVE = 'live-v1'
export const CAPABILITY_PROJECTS = 'projects-v1'
export const CAPABILITY_TRUSTED_DEVICES = 'trusted-devices-v1'
export const PAIRING_EXCHANGE_PATH = '/api/v1/pairing/exchange'
export const LOCAL_ENROLLMENT_PATH = '/api/v1/pairing/local'
export const CONNECTION_TICKET_PATH = '/api/v1/auth/ticket'
export const LIVE_PATH = '/api/v1/live'

export const pairingExchangeRequestSchema = z.object({
  code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/),
  deviceName: z.string().trim().min(1).max(80),
})
export const localEnrollmentRequestSchema = z.object({
  proof: z.string().regex(/^[0-9A-Za-z_-]{43,128}$/),
  deviceName: z.string().trim().min(1).max(80),
})
export const localEnrollmentDescriptorSchema = z.object({
  version: z.literal(1),
  serverId: serverIdSchema,
  serverUrl: z.url().refine((value) => {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') &&
      url.username === '' &&
      url.password === '' &&
      (url.pathname === '' || url.pathname === '/') &&
      url.search === '' &&
      url.hash === ''
    )
  }, 'Local enrollment server URL must use a loopback host'),
  proof: localEnrollmentRequestSchema.shape.proof,
})
export const trustedDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  scopes: z.array(
    z.enum(['projects:read', 'projects:write', 'events:read', 'devices:read', 'devices:revoke']),
  ),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
})
export const pairingExchangeResponseSchema = z.object({
  serverId: serverIdSchema,
  device: trustedDeviceSchema,
  token: z.string().min(32),
})
export const connectionTicketResponseSchema = z.object({
  ticket: z.string().min(32),
  expiresAt: z.iso.datetime(),
})

export const projectSetupStateSchema = z.enum(['setting_up', 'ready', 'needs_attention'])
export const rigSummarySchema = z.object({
  rigName: z.string().min(1),
  beadPrefix: z.string().min(1),
  registrationState: z.enum(['pending', 'ready', 'failed']),
  lastReconciledAt: z.iso.datetime().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
})
export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  repository: z.object({ rootId: z.string(), relativePath: z.string(), label: z.string() }),
  defaultBranch: z.string().min(1),
  setupState: projectSetupStateSchema,
  setupError: z.object({ code: z.string(), message: z.string() }).nullable(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  rig: rigSummarySchema,
})
export type Project = z.infer<typeof projectSchema>

export const repositoryRootSchema = z.object({ id: z.string(), label: z.string() })
export const repositoryEntrySchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  kind: z.enum(['directory', 'repository']),
})
export const repositoryStatusEntrySchema = z.object({
  path: z.string(),
  staged: z.boolean(),
  untracked: z.boolean(),
})
export const projectPreviewSchema = z.object({
  rootId: z.string(),
  relativePath: z.string(),
  suggestedName: z.string(),
  detectedBranch: z.string(),
  defaultBranch: z.string(),
  branches: z.array(z.string()),
  status: z.array(repositoryStatusEntrySchema),
  safe: z.boolean(),
  blockedReason: z.string().nullable(),
  repositoryMutations: z.array(z.string()),
  fingerprint: z.string().min(32),
})
export type ProjectPreview = z.infer<typeof projectPreviewSchema>

export const projectEventSchema = z.object({
  sequence: z.number().int().positive(),
  eventId: z.string(),
  type: z.string(),
  projectId: z.string(),
  projectVersion: z.number().int().positive(),
  payload: z.unknown(),
  occurredAt: z.iso.datetime(),
})
export const projectSnapshotSchema = z.object({
  projects: z.array(projectSchema),
  cursor: z.number().int().nonnegative(),
  resynchronized: z.boolean(),
  events: z.array(projectEventSchema),
})

export const liveMethodSchema = z.enum([
  'repositories.roots',
  'repositories.browse',
  'projects.previewCreate',
  'projects.list',
  'projects.get',
  'projects.create',
  'projects.retrySetup',
  'projects.subscribe',
  'devices.list',
  'devices.revoke',
  'workspaces.get',
  'conversations.send',
  'workers.updateModelBinding',
  'memory.add',
  'planner.start',
  'planner.cancel',
  'tasks.create',
  'tasks.update',
  'tasks.move',
  'tasks.resolve',
  'tasks.search',
  'tasks.decideMerge',
  'runs.cancel',
  'runs.retry',
  'runs.requestChanges',
  'runs.approve',
  'runs.archive',
])
export type LiveMethod = z.infer<typeof liveMethodSchema>
export const liveRequestSchema = z.object({
  id: z.string().min(1).max(100),
  method: liveMethodSchema,
  params: z.unknown().default({}),
  commandId: z.string().min(1).max(120).optional(),
})
export const liveResponseSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  }),
])
export const liveEventSchema = z.object({
  type: z.literal('project.event'),
  event: projectEventSchema,
})

export const repositoryBrowseParamsSchema = z.object({
  rootId: z.string(),
  relativePath: z.string().default(''),
})
export const projectPreviewParamsSchema = repositoryBrowseParamsSchema.extend({
  defaultBranch: z.string().optional(),
})
export const projectCreateParamsSchema = z.object({
  rootId: z.string(),
  relativePath: z.string(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2_000).optional(),
  defaultBranch: z.string().min(1),
  fingerprint: z.string().min(32),
})
export const projectIdParamsSchema = z.object({ projectId: z.string().min(1) })
export const projectSubscribeParamsSchema = z.object({
  afterCursor: z.number().int().nonnegative(),
})
export const deviceRevokeParamsSchema = z.object({
  deviceId: z.string().min(1),
  confirmSelf: z.boolean().default(false),
})

export type PairingExchangeResponse = z.infer<typeof pairingExchangeResponseSchema>
export type LocalEnrollmentDescriptor = z.infer<typeof localEnrollmentDescriptorSchema>
export type TrustedDevice = z.infer<typeof trustedDeviceSchema>
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>
export type LiveRequest = z.infer<typeof liveRequestSchema>
export type LiveResponse = z.infer<typeof liveResponseSchema>
