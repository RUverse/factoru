import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  artifactFor,
  ensureRuntimeDependency,
  linuxArtifactArchitecture,
  parseBootstrapArgs,
  sha256File,
} from './remote-bootstrap.mjs'

const execFileAsync = promisify(execFile)
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))

test('remote bootstrap shell entry point is executable, syntactically valid, and reads toolchain pins', async () => {
  const scriptPath = path.join(scriptsDirectory, 'remote-bootstrap.sh')
  await access(scriptPath, constants.X_OK)
  await execFileAsync('sh', ['-n', scriptPath])
  const source = await readFile(scriptPath, 'utf8')
  assert.match(source, /devEngines/)
  assert.match(source, /packageManager/)
  assert.match(source, /\.profile/)
  assert.match(source, /\.bashrc/)
  assert.doesNotMatch(source, /22\.13\.0|11\.20\.0/)
})

test('remote bootstrap accepts only one supported provider', () => {
  assert.equal(parseBootstrapArgs(['--provider', 'codex']), 'codex')
  assert.equal(parseBootstrapArgs(['--', '--provider', 'claude']), 'claude')
  assert.throws(() => parseBootstrapArgs([]), /Choose a provider/)
  assert.throws(() => parseBootstrapArgs(['--provider', 'gemini']), /Choose a provider/)
  assert.throws(
    () => parseBootstrapArgs(['--provider', 'codex', '--provider', 'claude']),
    /only once/,
  )
})

test('remote bootstrap maps supported Linux architectures and rejects 32-bit ARM', () => {
  assert.equal(linuxArtifactArchitecture('linux', 'arm64'), 'arm64')
  assert.equal(linuxArtifactArchitecture('linux', 'x64'), 'amd64')
  assert.throws(() => linuxArtifactArchitecture('linux', 'arm'), /32-bit Linux/)
  assert.throws(() => linuxArtifactArchitecture('darwin', 'arm64'), /Linux only/)
})

test('remote bootstrap constructs checksum-verified GitHub artifacts for both architectures', () => {
  const definition = {
    command: 'gc',
    version: '1.4.0',
    repository: 'gastownhall/gascity',
    fileNames: {
      arm64: 'gascity_1.4.0_linux_arm64.tar.gz',
      amd64: 'gascity_1.4.0_linux_amd64.tar.gz',
    },
    sha256: {
      arm64: 'a'.repeat(64),
      amd64: 'b'.repeat(64),
    },
  }
  for (const arch of ['arm64', 'amd64']) {
    const artifact = artifactFor(definition, arch)
    assert.match(artifact.url, /gastownhall\/gascity\/releases\/download\/v1\.4\.0/)
    assert.match(artifact.fileName, /linux/)
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/)
  }
})

test('remote bootstrap hashes downloaded content before installation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'factoru-bootstrap-test-'))
  const file = path.join(directory, 'artifact')
  await writeFile(file, 'factoru\n')
  assert.equal(
    await sha256File(file),
    '7881a0f28c5eb0b2e6d83ac352c6236e5f01254f67c1aca7decc9589adfda086',
  )
})

test('remote bootstrap skips compatible tools and installs an incompatible managed tool once', async () => {
  const spec = {
    command: 'gc',
    displayName: 'Gas City',
    versionArgs: ['version'],
    minimumVersion: '1.4.0',
    installVersion: '1.4.0',
    reason: 'test',
  }
  let output = '1.3.0'
  let installs = 0
  const context = {
    arch: 'arm64',
    artifacts: {
      gc: {
        command: 'gc',
        version: '1.4.0',
        repository: 'gastownhall/gascity',
        fileNames: { arm64: 'gc.tar.gz', amd64: 'gc.tar.gz' },
        sha256: { arm64: 'a'.repeat(64), amd64: 'b'.repeat(64) },
      },
    },
    binDirectory: '/tmp/factoru-test-bin',
    probe: async (_command, args) => {
      assert.deepEqual(args, ['version'])
      return { found: true, output }
    },
    evaluateDependency: (_spec, probe) => ({
      name: 'Gas City',
      status: probe.output === '1.4.0' ? 'ok' : 'unsupported_version',
      detail: probe.output,
    }),
    installArtifact: async (artifact) => {
      installs += 1
      assert.equal(artifact.command, 'gc')
      output = '1.4.0'
    },
  }

  assert.equal(await ensureRuntimeDependency(spec, context), true)
  assert.equal(await ensureRuntimeDependency(spec, context), false)
  assert.equal(installs, 1)
})
