/**
 * Wire protocol version negotiated between Factoru Desktop and Factoru Server.
 *
 * Compatibility is negotiated, never inferred from matching application
 * versions: a deployment may update one side before the other. Both sides
 * advertise the newest version they speak and the oldest they still accept.
 *
 * Bump `PROTOCOL_VERSION` for any additive change. Only raise
 * `MIN_SUPPORTED_PROTOCOL_VERSION` when support for an older version is
 * deliberately dropped, because doing so blocks older peers.
 */
export const PROTOCOL_VERSION = 4

export const MIN_SUPPORTED_PROTOCOL_VERSION = 1

/** Stable HTTP prefix; authenticated artifacts use this surface alongside live RPC. */
export const API_PREFIX = '/api/v1'
export const HEALTH_PATH = `${API_PREFIX}/health` as const
export const HANDSHAKE_PATH = `${API_PREFIX}/handshake` as const

/**
 * Capabilities let a newer client detect optional server features without
 * requiring a protocol bump for every addition.
 */
export const CAPABILITY_HEALTH = 'health' as const
export const CAPABILITY_HANDSHAKE = 'handshake' as const
