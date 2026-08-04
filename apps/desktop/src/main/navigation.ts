/**
 * Navigation and external-link policy for the untrusted renderer.
 *
 * These rules live outside `index.ts` so they can be tested without Electron.
 * Every URL reaching them is renderer-supplied and therefore untrusted.
 */

/** Only web URLs may be handed to the operating system's default handler. */
const OPENABLE_PROTOCOLS = new Set(['https:', 'http:'])

/**
 * Whether a renderer-supplied URL may be opened externally.
 *
 * `file:`, `smb:`, and registered custom protocols are rejected: passing them
 * to the shell would let renderer content launch local files or other
 * applications.
 */
export function isExternallyOpenable(rawUrl: string): boolean {
  try {
    return OPENABLE_PROTOCOLS.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

/**
 * Whether a navigation target is the development renderer itself.
 *
 * Origins are compared after parsing, never by string prefix: a prefix check
 * accepts `http://localhost:5173@evil.example/` because the dev-server string
 * becomes userinfo rather than the host.
 */
export function isSameOrigin(rawUrl: string, allowedOrigin: string | undefined): boolean {
  if (allowedOrigin === undefined || allowedOrigin === '') return false
  try {
    return new URL(rawUrl).origin === new URL(allowedOrigin).origin
  } catch {
    return false
  }
}
