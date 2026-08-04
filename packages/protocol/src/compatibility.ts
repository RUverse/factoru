import type { Incompatibility } from './schemas.js'
import { MIN_SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION } from './version.js'

/** The inclusive range of protocol versions one peer can speak. */
export interface ProtocolRange {
  readonly protocolVersion: number
  readonly minProtocolVersion: number
}

export type CompatibilityResult =
  | { compatible: true; negotiatedProtocolVersion: number; incompatibility: null }
  | { compatible: false; negotiatedProtocolVersion: null; incompatibility: Incompatibility }

/** The range this build of the protocol package speaks. */
export const LOCAL_PROTOCOL_RANGE: ProtocolRange = {
  protocolVersion: PROTOCOL_VERSION,
  minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
}

/**
 * Negotiates the highest protocol version both peers speak.
 *
 * Both sides run this so neither has to trust the other's verdict: the desktop
 * re-checks the server's answer against its own range before treating a
 * connection as usable.
 */
export function checkCompatibility(
  client: ProtocolRange,
  server: ProtocolRange,
): CompatibilityResult {
  const lowest = Math.max(client.minProtocolVersion, server.minProtocolVersion)
  const highest = Math.min(client.protocolVersion, server.protocolVersion)

  if (lowest <= highest) {
    return { compatible: true, negotiatedProtocolVersion: highest, incompatibility: null }
  }

  const incompatibility: Incompatibility =
    server.protocolVersion < client.minProtocolVersion
      ? {
          code: 'server_too_old',
          message:
            `This server speaks protocol ${server.minProtocolVersion}-${server.protocolVersion}, ` +
            `but this client requires at least ${client.minProtocolVersion}. Update Factoru Server.`,
        }
      : {
          code: 'client_too_old',
          message:
            `This server requires protocol ${server.minProtocolVersion}-${server.protocolVersion}, ` +
            `but this client speaks at most ${client.protocolVersion}. Update Factoru Desktop.`,
        }

  return { compatible: false, negotiatedProtocolVersion: null, incompatibility }
}
