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
  readAllocatedPortBase,
  resolveWorktreeRoot,
  processEnvForDevelopment,
  worktreeIdFor,
  writeAllocatedPortBase,
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
const { dataDir } = devEnvFor(worktreeRoot)

/*
 * Whoever starts the server owns the allocation and records it. A separately
 * started desktop reads that record instead of the derived block, because the
 * derived block may belong to another worktree that claimed it first — in which
 * case the desktop would otherwise connect to the wrong worktree's server.
 */
let portBase
if (only === 'desktop') {
  const allocated = readAllocatedPortBase(dataDir)
  portBase = allocated ?? preferredBase
  if (allocated !== null && allocated !== preferredBase) {
    console.log(`[factoru] using the port block ${allocated} recorded by this worktree's server.`)
  }
} else {
  portBase = await findFreePortBlock(preferredBase)
  if (portBase !== preferredBase) {
    console.warn(
      `[factoru] derived port block ${preferredBase} is in use; using ${portBase} for this run.`,
    )
  }
  writeAllocatedPortBase(dataDir, portBase)
}

const dev = devEnvFor(worktreeRoot, { portBase })

// Workspace packages are consumed from their build output, so the applications
// need them compiled before the watchers start.
const build = spawnSync(
  'pnpm',
  [
    '--filter',
    '@factoru/domain',
    '--filter',
    '@factoru/protocol',
    '--filter',
    '@factoru/database',
    '--filter',
    '@factoru/gas-city',
    'run',
    'build',
  ],
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
    env: processEnvForDevelopment(dev.env),
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
