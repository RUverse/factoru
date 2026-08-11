#!/usr/bin/env node
/** Source-preview launcher installed as `factoru-server` by remote bootstrap. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { currentDevEnv, processEnvForDevelopment } from './worktree-env.mjs'

export function sourcePreviewEnvironment(repositoryRoot, parentEnvironment = process.env) {
  const dev = currentDevEnv(repositoryRoot)
  const env = processEnvForDevelopment(dev.env, parentEnvironment)
  if (!parentEnvironment.FACTORU_REPOSITORY_ROOTS?.trim()) {
    env.FACTORU_REPOSITORY_ROOTS = JSON.stringify([path.join(os.homedir(), 'factoru-repositories')])
  }
  return { dev, env }
}

export function main(argv = process.argv.slice(2)) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const entrypoint = path.join(repositoryRoot, 'apps/server/dist/main.js')
  if (!fs.existsSync(entrypoint)) {
    throw new Error(
      `Factoru Server has not been built at ${entrypoint}; rerun ./scripts/remote-bootstrap.sh`,
    )
  }
  const { env } = sourcePreviewEnvironment(repositoryRoot)
  const result = spawnSync(process.execPath, [entrypoint, ...argv], {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

export function isDirectRun(argvPath, moduleUrl = import.meta.url) {
  if (!argvPath) return false
  try {
    return fs.realpathSync(argvPath) === fs.realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}

if (isDirectRun(process.argv[1])) {
  try {
    process.exitCode = main()
  } catch (error) {
    process.stderr.write(
      `[factoru-server] launcher error: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
