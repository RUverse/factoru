#!/usr/bin/env node
/** Run operator commands against this worktree's isolated development roots. */
import process from 'node:process'
import { developmentEnvironment, main } from './factoru-server.mjs'

try {
  process.exitCode = main(process.argv.slice(2), { environment: developmentEnvironment })
} catch (error) {
  process.stderr.write(
    `[factoru-dev-server] launcher error: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
}
