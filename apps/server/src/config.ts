import { homedir } from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { isLoopbackUrl } from '@factoru/gas-city'

export interface RepositoryRootConfig {
  readonly id: string
  readonly label: string
  readonly path: string
}

export interface ServerConfig {
  /** Bound interface. Localhost by default; remote exposure is deliberate. */
  readonly host: string
  readonly port: number
  /** Directory that owns this server's durable state, including its identity. */
  readonly dataDir: string
  readonly databaseFile: string
  readonly gasCityPath: string
  /** Host-local, unauthenticated Gas City supervisor control plane. */
  readonly gasCitySupervisorUrl: string
  /** Versioned Factoru pack source used to project generated chat agents. */
  readonly factoruPackPath: string
  readonly repositoryRoots: readonly RepositoryRootConfig[]
  readonly trustLoopbackProxy: boolean
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
}

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 8787

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

/** Factoru Server always binds loopback; remote HTTPS terminates at a local proxy. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1'])

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

function parseRepositoryRoots(raw: string | undefined): RepositoryRootConfig[] {
  if (!raw?.trim()) return []
  let values: unknown
  try {
    values = JSON.parse(raw)
  } catch {
    throw new ServerConfigError('FACTORU_REPOSITORY_ROOTS must be a JSON array of absolute paths')
  }
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new ServerConfigError('FACTORU_REPOSITORY_ROOTS must be a JSON array of absolute paths')
  }
  const seen = new Set<string>()
  return values.map((value) => {
    if (!path.isAbsolute(value)) {
      throw new ServerConfigError(`Repository root must be absolute, got ${value}`)
    }
    let realPath: string
    try {
      realPath = fs.realpathSync(value)
    } catch {
      throw new ServerConfigError(`Repository root does not exist or is inaccessible: ${value}`)
    }
    if (!fs.statSync(realPath).isDirectory()) {
      throw new ServerConfigError(`Repository root is not a directory: ${value}`)
    }
    if (seen.has(realPath)) throw new ServerConfigError(`Duplicate repository root: ${value}`)
    seen.add(realPath)
    return {
      id: `root_${createHash('sha256').update(realPath).digest('hex').slice(0, 12)}`,
      label: path.basename(realPath) || realPath,
      path: realPath,
    }
  })
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

  const host = env.FACTORU_HOST?.trim() || DEFAULT_HOST
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new ServerConfigError(
      `FACTORU_HOST must be a loopback address; got ${host}. ` +
        `Reach a remote server through an HTTPS loopback proxy instead.`,
    )
  }

  const gasCitySupervisorUrl =
    env.FACTORU_GAS_CITY_SUPERVISOR_URL?.trim() || 'http://127.0.0.1:8372'
  if (!isLoopbackUrl(gasCitySupervisorUrl)) {
    throw new ServerConfigError('FACTORU_GAS_CITY_SUPERVISOR_URL must use a loopback address')
  }
  const factoruPackPath =
    env.FACTORU_PACK_PATH?.trim() || path.resolve(process.cwd(), 'packs/factoru-default')
  if (!path.isAbsolute(factoruPackPath)) {
    throw new ServerConfigError(`FACTORU_PACK_PATH must be absolute, got ${factoruPackPath}`)
  }

  return {
    host,
    port: parsePort(env.FACTORU_PORT),
    dataDir,
    databaseFile: path.join(dataDir, 'factoru.sqlite'),
    gasCityPath: env.FACTORU_GAS_CITY_PATH?.trim() || path.join(dataDir, 'gas-city'),
    gasCitySupervisorUrl,
    factoruPackPath,
    repositoryRoots: parseRepositoryRoots(env.FACTORU_REPOSITORY_ROOTS),
    trustLoopbackProxy: env.FACTORU_TRUST_PROXY?.trim() === 'loopback',
    logLevel: logLevel as ServerConfig['logLevel'],
  }
}
