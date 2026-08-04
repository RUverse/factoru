/**
 * The Factoru Server application version.
 *
 * It is declared here rather than imported from `package.json` so the compiled
 * output has no dependency on the package layout. `version.test.ts` fails if it
 * drifts from `package.json`.
 */
export const SERVER_VERSION = '0.0.0'

/** Identifies this application in handshake and log output. */
export const SERVER_NAME = 'factoru-server'
