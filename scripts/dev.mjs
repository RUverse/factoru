#!/usr/bin/env node
/**
 * Runs Factoru Server and Factoru Desktop against this worktree's isolated
 * development state.
 *
 *   pnpm dev                  both applications
 *   pnpm dev --only server    server only
 *   pnpm dev --only desktop   desktop only (expects a server already running)
 */
import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'
import {
  devEnvFor,
  findFreePortBlock,
  portBaseFor,
  resolveWorktreeRoot,
  worktreeIdFor,
} from './worktree-env.mjs'

const argv = process.argv.slice(2)
const onlyIndex = argv.indexOf('--only')
const only = onlyIndex === -1 ? 'all' : argv[onlyIndex + 1]

if (!['all', 'server', 'desktop'].includes(only)) {
  console.error(`Unknown --only target: ${only}. Expected "server" or "desktop".`)
  process.exit(1)
}

const worktreeRoot = resolveWorktreeRoot()
const preferredBase = portBaseFor(worktreeIdFor(worktreeRoot))

// `--only desktop` attaches to a server that is already listening on this
// worktree's derived block, so it must not step away from a port in use.
const portBase = only === 'desktop' ? preferredBase : await findFreePortBlock(preferredBase)
const dev = devEnvFor(worktreeRoot, { portBase })

if (portBase !== preferredBase) {
  console.warn(
    `[factoru] derived port block ${preferredBase} is in use; using ${portBase} for this run.`,
  )
}

// Workspace packages are consumed from their build output, so the applications
// need them compiled before the watchers start.
const build = spawnSync(
  'pnpm',
  ['--filter', '@factoru/domain', '--filter', '@factoru/protocol', 'run', 'build'],
  { cwd: worktreeRoot, stdio: 'inherit' },
)
if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

console.log(`[factoru] worktree ${dev.worktreeId}`)
console.log(`[factoru] server   ${dev.serverUrl}`)
console.log(`[factoru] state    ${dev.dataDir}`)

const targets = []
if (only === 'all' || only === 'server') {
  targets.push({ name: 'server', filter: '@factoru/server' })
}
if (only === 'all' || only === 'desktop') {
  targets.push({ name: 'desktop', filter: '@factoru/desktop' })
}

let shuttingDown = false

function shutdown(exitCode) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    child.kill('SIGTERM')
  }
  process.exitCode = exitCode
  setTimeout(() => process.exit(exitCode), 2_000).unref()
}

const children = targets.map(({ name, filter }) => {
  const child = spawn('pnpm', ['--filter', filter, 'run', 'dev'], {
    cwd: worktreeRoot,
    env: { ...process.env, ...dev.env },
    stdio: 'inherit',
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`[factoru] ${name} exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`)
    shutdown(code ?? 1)
  })
  return child
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
