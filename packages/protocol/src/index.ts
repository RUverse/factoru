export {
  PROTOCOL_VERSION,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  API_PREFIX,
  HEALTH_PATH,
  HANDSHAKE_PATH,
  CAPABILITY_HEALTH,
  CAPABILITY_HANDSHAKE,
} from './version.js'

export {
  SERVER_ID_PATTERN,
  serverIdSchema,
  protocolVersionSchema,
  healthStatusSchema,
  serverDescriptorSchema,
  healthResponseSchema,
  handshakeRequestSchema,
  handshakeResponseSchema,
  incompatibilitySchema,
  descriptorFromHealth,
  type HealthStatus,
  type ServerDescriptor,
  type HealthResponse,
  type HandshakeRequest,
  type HandshakeResponse,
  type Incompatibility,
} from './schemas.js'

export {
  checkCompatibility,
  LOCAL_PROTOCOL_RANGE,
  type ProtocolRange,
  type CompatibilityResult,
} from './compatibility.js'

export {
  problemSchema,
  problemCodeSchema,
  problem,
  FactoruProtocolError,
  type Problem,
  type ProblemCode,
  type ClientErrorCode,
  type FactoruErrorCode,
} from './errors.js'

export {
  createFactoruClient,
  type FactoruClient,
  type FactoruClientOptions,
  type FetchLike,
  type RequestOptions,
  type HandshakeOutcome,
} from './client.js'

export * from './milestone2.js'
export * from './milestone3.js'
export * from './milestone4.js'
