import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  symlink,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function parseBootstrapArgs(args) {
  let provider = null
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === '--provider') {
      if (provider !== null) throw new Error('--provider may be supplied only once')
      provider = args[index + 1] ?? ''
      index += 1
      continue
    }
    throw new Error(`Unknown bootstrap argument: ${argument}`)
  }
  if (!['codex', 'claude'].includes(provider)) {
    throw new Error('Choose a provider with --provider codex or --provider claude')
  }
  return provider
}

export function linuxArtifactArchitecture(platform, arch) {
  if (platform !== 'linux') throw new Error('The remote bootstrap supports Linux only')
  if (arch === 'arm64') return 'arm64'
  if (arch === 'x64') return 'amd64'
  if (['arm', 'ia32'].includes(arch)) {
    throw new Error('32-bit Linux is unsupported; install a 64-bit operating system')
  }
  throw new Error(`Unsupported Linux architecture: ${arch}`)
}

export function artifactFor(definition, arch) {
  if (!definition) throw new Error('Factoru does not own installation of this dependency')
  const fileName = definition.fileNames[arch]
  const sha256 = definition.sha256[arch]
  if (!fileName || !sha256)
    throw new Error(`No verified ${arch} artifact exists for ${definition.command}`)
  return {
    command: definition.command,
    executable: definition.command,
    version: definition.version,
    fileName,
    url: `https://github.com/${definition.repository}/releases/download/v${definition.version}/${fileName}`,
    sha256,
  }
}

export async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function commandResult(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let stdout = ''
    let stderr = ''
    if (options.capture) {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
    }
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      resolve({ code: code ?? 1, signal, stdout, stderr })
    })
  })
}

async function run(command, args, options = {}) {
  const result = await commandResult(command, args, options)
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed${result.signal ? ` with ${result.signal}` : ` with exit code ${result.code}`}`,
    )
  }
  return result
}

async function probe(command, args) {
  try {
    const result = await commandResult(command, args, { capture: true })
    return {
      found: true,
      output: `${result.stdout}${result.stderr}`,
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { found: false, output: `${command} was not found` }
    }
    throw error
  }
}

async function findExecutable(directory, executable) {
  const matches = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(candidate)
      else if (entry.isFile() && entry.name === executable) matches.push(candidate)
    }
  }
  await visit(directory)
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${executable} executable in the verified archive; found ${matches.length}`,
    )
  }
  return matches[0]
}

async function installArtifact(artifact, binDirectory) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'factoru-runtime-'))
  try {
    const archivePath = path.join(temporaryRoot, artifact.fileName)
    const extractPath = path.join(temporaryRoot, 'extract')
    await mkdir(extractPath)
    process.stdout.write(`Downloading ${artifact.command} ${artifact.version}...\n`)
    await run('curl', ['-fsSL', '-o', archivePath, artifact.url])
    const actualHash = await sha256File(archivePath)
    if (actualHash !== artifact.sha256) {
      throw new Error(
        `Checksum mismatch for ${artifact.fileName}: expected ${artifact.sha256}, received ${actualHash}`,
      )
    }
    const listing = await run('tar', ['-tzf', archivePath], { capture: true })
    for (const entry of listing.stdout.split('\n').filter(Boolean)) {
      if (entry.startsWith('/') || entry.split('/').includes('..')) {
        throw new Error(`Unsafe archive path in ${artifact.fileName}: ${entry}`)
      }
    }
    await run('tar', [
      '--no-same-owner',
      '--no-same-permissions',
      '-xzf',
      archivePath,
      '-C',
      extractPath,
    ])
    const source = await findExecutable(extractPath, artifact.executable)
    const destination = path.join(binDirectory, artifact.executable)
    const stagedDestination = path.join(
      binDirectory,
      `.${artifact.executable}.factoru-install-${process.pid}`,
    )
    await copyFile(source, stagedDestination)
    await chmod(stagedDestination, 0o755)
    await rename(stagedDestination, destination)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

export async function ensureRuntimeDependency(spec, context) {
  const before = await context.probe(spec.command, spec.versionArgs)
  const finding = context.evaluateDependency(spec, before)
  if (finding.status === 'ok') {
    process.stdout.write(`[OK] ${spec.displayName}: ${finding.detail}\n`)
    return false
  }
  if (!spec.installVersion) {
    throw new Error(`${spec.displayName} is not ready and has no Factoru-managed installer`)
  }
  const definition = context.artifacts[spec.command]
  if (!definition || definition.version !== spec.installVersion) {
    throw new Error(`No verified ${spec.installVersion} artifact is defined for ${spec.command}`)
  }
  const artifact = artifactFor(definition, context.arch)
  await context.installArtifact(artifact, context.binDirectory)
  const after = await context.probe(spec.command, spec.versionArgs)
  const installedFinding = context.evaluateDependency(spec, after)
  if (installedFinding.status !== 'ok') {
    throw new Error(
      `${spec.displayName} ${spec.installVersion} was installed but failed readiness: ${installedFinding.detail}`,
    )
  }
  process.stdout.write(`[OK] ${spec.displayName}: ${installedFinding.detail}\n`)
  return true
}

export async function installCliLauncher(root, binDirectory) {
  const source = path.join(root, 'scripts', 'factoru-server.mjs')
  const destination = path.join(binDirectory, 'factoru-server')
  await chmod(source, 0o755)
  await mkdir(binDirectory, { recursive: true })
  try {
    const existing = await lstat(destination)
    if (!existing.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-symlink Factoru CLI path: ${destination}`)
    }
    await rm(destination)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      // No previous Factoru-managed launcher exists.
    } else if (error instanceof Error) {
      throw error
    } else {
      throw new Error(String(error), { cause: error })
    }
  }
  await symlink(source, destination)
  return destination
}

async function requireCleanDevCheckout() {
  const branch = await run('git', ['branch', '--show-current'], { capture: true })
  if (branch.stdout.trim() !== 'dev') {
    throw new Error(
      `Deployment checkout must be on dev; found ${branch.stdout.trim() || 'no branch'}`,
    )
  }
  const status = await run('git', ['status', '--porcelain', '--untracked-files=normal'], {
    capture: true,
  })
  if (status.stdout.trim()) {
    throw new Error(
      'Deployment checkout is dirty; preserve or remove those changes before bootstrap',
    )
  }
}

async function main() {
  const provider = parseBootstrapArgs(process.argv.slice(2))
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    throw new Error('Run the bootstrap as the unprivileged deployment user, not root')
  }
  const arch = linuxArtifactArchitecture(process.platform, process.arch)
  await requireCleanDevCheckout()

  process.stdout.write('Installing the Factoru workspace from the frozen lockfile...\n')
  await run('pnpm', ['install', '--frozen-lockfile'])
  await run('pnpm', ['--filter', '@factoru/gas-city', 'run', 'build'])

  const gasCity = await import(
    pathToFileURL(path.join(repositoryRoot, 'packages/gas-city/dist/index.js')).href
  )
  const installRoot =
    process.env.FACTORU_BOOTSTRAP_ROOT ?? path.join(os.homedir(), '.local/share/factoru')
  const binDirectory = path.join(installRoot, 'bin')
  await mkdir(binDirectory, { recursive: true })

  const context = {
    arch,
    artifacts: gasCity.SOURCE_BOOTSTRAP_ARTIFACTS,
    binDirectory,
    evaluateDependency: gasCity.evaluateDependency,
    installArtifact,
    probe,
  }
  for (const spec of gasCity.REQUIRED_DEPENDENCIES.filter((item) => item.installVersion)) {
    await ensureRuntimeDependency(spec, context)
  }

  const repositoriesRoot = path.join(os.homedir(), 'factoru-repositories')
  await mkdir(repositoriesRoot, { recursive: true })
  const repositoriesStats = await stat(repositoriesRoot)
  if (!repositoriesStats.isDirectory()) throw new Error(`${repositoriesRoot} is not a directory`)

  process.stdout.write('Running the complete read-only preflight...\n')
  await run('pnpm', ['remote:preflight', '--', '--provider', provider])
  const cliPath = await installCliLauncher(repositoryRoot, binDirectory)
  process.stdout.write('\nFactoru remote bootstrap completed. No Factoru state was created.\n')
  process.stdout.write(`Project repositories: ${repositoriesRoot}\n`)
  process.stdout.write(`Operator CLI: ${cliPath}\n`)
  process.stdout.write(`Next: factoru-server providers configure --provider ${provider}\n`)
}

const directRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (directRun) {
  main().catch((error) => {
    process.stderr.write(
      `Factoru bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
