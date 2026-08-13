import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { developmentEnvironment, isDirectRun, sourcePreviewEnvironment } from './factoru-server.mjs'
import { installCliLauncher } from './remote-bootstrap.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))

test('source-preview CLI launcher is executable and bootstrap installs its symlink', async () => {
  const launcher = path.join(scriptsDirectory, 'factoru-server.mjs')
  await access(launcher, constants.X_OK)
  const installRoot = await mkdtemp(path.join(os.tmpdir(), 'factoru-cli-test-'))
  const binDirectory = path.join(installRoot, 'bin')
  try {
    const installed = await installCliLauncher(path.dirname(scriptsDirectory), binDirectory)
    assert.equal(installed, path.join(binDirectory, 'factoru-server'))
    assert.equal(await readFile(installed, 'utf8'), await readFile(launcher, 'utf8'))
    assert.equal(isDirectRun(installed, pathToFileURL(launcher).href), true)
    assert.equal(await installCliLauncher(path.dirname(scriptsDirectory), binDirectory), installed)
  } finally {
    await rm(installRoot, { recursive: true, force: true })
  }
})

test('development commands keep worktree-local repository and project roots', () => {
  const root = path.dirname(scriptsDirectory)
  const { env } = developmentEnvironment(root, {})
  assert.equal(env.FACTORU_REPOSITORY_ROOTS, JSON.stringify([root]))
  assert.equal(
    env.FACTORU_PROJECTS_ROOT,
    path.join(root, '.factoru-dev', env.FACTORU_WORKTREE_ID, 'projects'),
  )
})

test('installed source-preview commands retain managed home roots', () => {
  const root = path.dirname(scriptsDirectory)
  const { env } = sourcePreviewEnvironment(root, {})
  assert.equal(
    env.FACTORU_REPOSITORY_ROOTS,
    JSON.stringify([path.join(os.homedir(), 'factoru-repositories')]),
  )
  assert.equal(env.FACTORU_PROJECTS_ROOT, path.join(os.homedir(), 'factoru-projects'))
})
