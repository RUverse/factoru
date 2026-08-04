import { homedir } from 'node:os'
import path from 'node:path'

export interface ServerConfig {
  /** Bound interface. Localhost by default; remote exposure is deliberate. */
  readonly host: string
  readonly port: number
  /** Directory that owns this server's durable state, including its identity. */
  readonly dataDir: string
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
}

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 8787

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigError'
  }
}

/**
 * The platform default data directory. Development runs override this with a
 * per-worktree directory so that concurrent worktrees never share server state
 * (see scripts/worktree-env.mjs).
 */
export function defaultDataDir(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Factoru')
  }
  const xdg = process.env.XDG_DATA_HOME
  if (xdg && path.isAbsolute(xdg)) {
    return path.join(xdg, 'factoru')
  }
  return path.join(home, '.local', 'share', 'factoru')
}

function parsePort(raw: string | undefined): number {
  // A blank value means "unset", matching how the other settings read.
  const value = raw?.trim() ?? ''
  if (value === '') return DEFAULT_PORT

  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(port) || port > 65_535) {
    throw new ServerConfigError(`FACTORU_PORT must be an integer between 0 and 65535, got ${raw}`)
  }
  return port
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.FACTORU_DATA_DIR?.trim() || defaultDataDir()
  if (!path.isAbsolute(dataDir)) {
    throw new ServerConfigError(`FACTORU_DATA_DIR must be an absolute path, got ${dataDir}`)
  }

  const logLevel = env.FACTORU_LOG_LEVEL?.trim() || 'info'
  if (!LOG_LEVELS.has(logLevel)) {
    throw new ServerConfigError(`FACTORU_LOG_LEVEL must be one of ${[...LOG_LEVELS].join(', ')}`)
  }

  return {
    host: env.FACTORU_HOST?.trim() || DEFAULT_HOST,
    port: parsePort(env.FACTORU_PORT),
    dataDir,
    logLevel: logLevel as ServerConfig['logLevel'],
  }
}
