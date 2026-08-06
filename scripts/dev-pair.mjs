#!/usr/bin/env node
/** Creates a pairing code in the same isolated database used by `pnpm dev`. */
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import {
  devEnvFor,
  portBaseFor,
  processEnvForDevelopment,
  readAllocatedPortBase,
  resolveWorktreeRoot,
  worktreeIdFor,
} from './worktree-env.mjs'

const worktreeRoot = resolveWorktreeRoot()
const initial = devEnvFor(worktreeRoot)
const portBase = readAllocatedPortBase(initial.dataDir) ?? portBaseFor(worktreeIdFor(worktreeRoot))
const dev = devEnvFor(worktreeRoot, { portBase })
const result = spawnSync('pnpm', ['--filter', '@factoru/server', 'start', 'pair'], {
  cwd: worktreeRoot,
  env: processEnvForDevelopment(dev.env),
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
