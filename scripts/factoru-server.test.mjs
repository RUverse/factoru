import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
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
    assert.equal(await installCliLauncher(path.dirname(scriptsDirectory), binDirectory), installed)
  } finally {
    await rm(installRoot, { recursive: true, force: true })
  }
})
