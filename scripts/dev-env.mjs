#!/usr/bin/env node
/**
 * Prints this worktree's development environment.
 *
 *   pnpm dev:env            human readable
 *   pnpm dev:env --json     machine readable
 *   pnpm dev:env --export   shell `export` lines for an external tool
 */
import { currentDevEnv } from './worktree-env.mjs'

const args = new Set(process.argv.slice(2))
const env = currentDevEnv()

if (args.has('--json')) {
  console.log(JSON.stringify(env, null, 2))
} else if (args.has('--export')) {
  for (const [key, value] of Object.entries(env.env)) {
    console.log(`export ${key}=${JSON.stringify(value)}`)
  }
} else {
  console.log(`Factoru development environment`)
  console.log(`  worktree        ${env.worktreeRoot}`)
  console.log(`  worktree id     ${env.worktreeId}`)
  console.log(`  data directory  ${env.dataDir}`)
  console.log(`  server          ${env.serverUrl}`)
  console.log(`  renderer        http://127.0.0.1:${env.rendererPort}`)
  console.log(`  inspect         ${env.serverInspectPort} (reserved: ${env.reservedPort})`)
  console.log()
  console.log(`Ports are derived from the worktree path; \`pnpm dev\` steps forward if the`)
  console.log(`derived block is already in use.`)
}
