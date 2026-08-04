/**
 * Deterministic, collision-free development state for every Git worktree.
 *
 * Two worktrees of this repository must never share a server data directory or
 * a development port, and the values must be stable across restarts so a
 * developer can bookmark them.
 *
 * The data directory lives inside the worktree, so it is collision-free by
 * construction. Ports are derived from the worktree path, which makes them
 * stable but not unique on its own; `findFreePortBlock` deterministically
 * probes forward when a derived block is already in use.
 *
 * See docs/adr/0006-per-worktree-development-state.md.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/** Development ports sit above the common service ports and below the ephemeral range. */
export const PORT_RANGE_START = 20_000
export const PORTS_PER_WORKTREE = 4
export const WORKTREE_SLOT_COUNT = 5_000
export const PORT_RANGE_END = PORT_RANGE_START + WORKTREE_SLOT_COUNT * PORTS_PER_WORKTREE

/** Development state lives inside the worktree so removing it removes the state. */
export const DEV_STATE_DIRNAME = '.factoru-dev'

export const DEV_HOST = '127.0.0.1'

export function worktreeIdFor(worktreeRoot) {
  if (!path.isAbsolute(worktreeRoot)) {
    throw new Error(`worktreeIdFor requires an absolute path, got ${worktreeRoot}`)
  }
  return createHash('sha256').update(worktreeRoot).digest('hex').slice(0, 12)
}

export function portBaseFor(worktreeId) {
  const slot = Number.parseInt(worktreeId.slice(0, 8), 16) % WORKTREE_SLOT_COUNT
  return PORT_RANGE_START + slot * PORTS_PER_WORKTREE
}

export function portsFor(base) {
  return {
    serverPort: base,
    rendererPort: base + 1,
    serverInspectPort: base + 2,
    reservedPort: base + 3,
  }
}

export function resolveWorktreeRoot(cwd = process.cwd()) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim()
  return realpathSync(root)
}

/**
 * Returns the development environment for one worktree, including the
 * environment variables Factoru Server and Factoru Desktop read.
 *
 * `portBase` overrides the derived block after `findFreePortBlock` has resolved
 * a conflict, so that the harness and the printed environment always agree.
 */
export function devEnvFor(worktreeRoot, { portBase } = {}) {
  const worktreeId = worktreeIdFor(worktreeRoot)
  const base = portBase ?? portBaseFor(worktreeId)
  const ports = portsFor(base)
  const dataDir = path.join(worktreeRoot, DEV_STATE_DIRNAME, worktreeId)
  const serverUrl = `http://${DEV_HOST}:${ports.serverPort}`

  return {
    worktreeRoot,
    worktreeId,
    dataDir,
    serverUrl,
    portBase: base,
    ...ports,
    env: {
      FACTORU_WORKTREE_ID: worktreeId,
      FACTORU_DATA_DIR: dataDir,
      FACTORU_HOST: DEV_HOST,
      FACTORU_PORT: String(ports.serverPort),
      FACTORU_SERVER_URL: serverUrl,
      FACTORU_RENDERER_PORT: String(ports.rendererPort),
      FACTORU_LOG_LEVEL: process.env.FACTORU_LOG_LEVEL ?? 'debug',
    },
  }
}

function isPortFree(port, host = DEV_HOST) {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, host)
  })
}

/**
 * Returns the first port block at or after `preferredBase` whose ports are all
 * free. Probing is deterministic: the same worktree keeps its block for as long
 * as nothing else takes it.
 */
export async function findFreePortBlock(preferredBase, { host = DEV_HOST, maxAttempts = 64 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const base =
      PORT_RANGE_START +
      ((preferredBase - PORT_RANGE_START + attempt * PORTS_PER_WORKTREE) %
        (WORKTREE_SLOT_COUNT * PORTS_PER_WORKTREE))
    const ports = Object.values(portsFor(base))
    const free = await Promise.all(ports.map((port) => isPortFree(port, host)))
    if (free.every(Boolean)) {
      return base
    }
  }
  throw new Error(
    `Could not find a free development port block near ${preferredBase} after ${maxAttempts} attempts.`,
  )
}

export function currentDevEnv(cwd = process.cwd()) {
  return devEnvFor(resolveWorktreeRoot(cwd))
}
