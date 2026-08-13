import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  SUPPORTED_HARNESSES,
  checkDependencies,
  compareVersions,
  parseVersion,
  satisfiesMinimum,
  type ProbeResult,
  type ReadinessFinding,
  type SupportedHarness,
} from '@factoru/gas-city'

const execFileAsync = promisify(execFile)

interface RootManifest {
  readonly engines: { readonly node: string }
  readonly devEngines: { readonly runtime: { readonly name: string; readonly version: string } }
  readonly packageManager: string
}

export interface DoctorFinding {
  readonly name: string
  readonly status: 'ok' | 'error' | 'info'
  readonly detail: string
  readonly remedy?: string
}

export interface DoctorReport {
  readonly ok: boolean
  readonly provider: SupportedHarness
  readonly findings: readonly DoctorFinding[]
}

export interface ExecutableResult extends ProbeResult {
  readonly succeeded: boolean
}

export interface DoctorEnvironment {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly nodeVersion: string
  readonly totalMemoryBytes: number
  readonly freeDiskBytes: number
  readonly manifest: RootManifest
  run(command: string, args: readonly string[]): Promise<ExecutableResult>
}

function rootManifestPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../package.json')
}

async function readRootManifest(): Promise<RootManifest> {
  return JSON.parse(await readFile(rootManifestPath(), 'utf8')) as RootManifest
}

function freeDiskBytes(directory: string): number {
  const stats = fs.statfsSync(directory)
  return Number(stats.bavail) * Number(stats.bsize)
}

async function runExecutable(command: string, args: readonly string[]): Promise<ExecutableResult> {
  try {
    const result = await execFileAsync(command, [...args], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
    return {
      found: true,
      succeeded: true,
      output: `${result.stdout}${result.stderr}`,
    }
  } catch (error) {
    const missing =
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
    const stdout =
      typeof error === 'object' && error !== null && 'stdout' in error
        ? String(error.stdout ?? '')
        : ''
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr ?? '')
        : ''
    return {
      found: !missing,
      succeeded: false,
      output: `${stdout}${stderr}` || (error instanceof Error ? error.message : String(error)),
    }
  }
}

export async function systemDoctorEnvironment(): Promise<DoctorEnvironment> {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    totalMemoryBytes: os.totalmem(),
    freeDiskBytes: freeDiskBytes(process.cwd()),
    manifest: await readRootManifest(),
    run: runExecutable,
  }
}

export async function runtimeDependencyFindings(
  environment: DoctorEnvironment,
): Promise<ReadinessFinding[]> {
  return checkDependencies(async (command, versionArgs) => {
    const result = await environment.run(command, versionArgs)
    return { found: result.found, output: result.output }
  })
}

export async function doltAuthorIdentityFinding(
  environment: DoctorEnvironment,
): Promise<DoctorFinding> {
  const [name, email] = await Promise.all([
    environment.run('dolt', ['config', '--global', '--get', 'user.name']),
    environment.run('dolt', ['config', '--global', '--get', 'user.email']),
  ])
  if (name.succeeded && name.output.trim() && email.succeeded && email.output.trim()) {
    return {
      name: 'Dolt author identity',
      status: 'ok',
      detail: 'Global Dolt user.name and user.email are configured.',
    }
  }
  return {
    name: 'Dolt author identity',
    status: 'error',
    detail: 'Dolt requires global user.name and user.email before Gas City can initialize.',
    remedy:
      'Run dolt config --global --add user.name "Your Name" and dolt config --global --add user.email "you@example.com" as the Factoru Server user.',
  }
}

function parseNodeRange(range: string): { minimum: string; belowExclusive: string } | null {
  const match = /^>=(\S+)\s+<(\S+)$/.exec(range.trim())
  if (!match) return null
  const normalize = (value: string) => (/^\d+$/.test(value) ? `${value}.0.0` : value)
  return { minimum: normalize(match[1]!), belowExclusive: normalize(match[2]!) }
}

function parsePnpmPin(packageManager: string): string | null {
  const match = /^pnpm@(\S+)$/.exec(packageManager.trim())
  return match?.[1] ?? null
}

function formatGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

function providerAuthFinding(provider: SupportedHarness, result: ExecutableResult): DoctorFinding {
  if (!result.found) {
    return {
      name: `${provider} authentication`,
      status: 'error',
      detail: `${provider} was not found.`,
      remedy: `Install the ${provider} CLI and authenticate it as this unprivileged server user.`,
    }
  }

  if (provider === 'codex') {
    if (result.succeeded && /^\s*Logged in\b/im.test(result.output)) {
      return { name: 'codex authentication', status: 'ok', detail: result.output.trim() }
    }
    return {
      name: 'codex authentication',
      status: 'error',
      detail: result.output.trim() || 'Codex did not confirm a login.',
      remedy: 'Run `codex login` as this unprivileged server user, then rerun the preflight.',
    }
  }

  const loggedIn = (() => {
    try {
      const parsed = JSON.parse(result.output) as { loggedIn?: unknown }
      return parsed.loggedIn === true
    } catch {
      return false
    }
  })()
  if (result.succeeded && loggedIn) {
    return { name: 'claude authentication', status: 'ok', detail: 'Claude is logged in.' }
  }
  return {
    name: 'claude authentication',
    status: 'error',
    detail: result.output.trim() || 'Claude did not confirm a login.',
    remedy: 'Run `claude auth login` as this unprivileged server user, then rerun the preflight.',
  }
}

export function parseDoctorArgs(args: readonly string[]): SupportedHarness {
  let provider: string | null = null
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === '--provider') {
      if (provider !== null) throw new Error('--provider may be supplied only once')
      provider = args[index + 1]?.trim() ?? ''
      index += 1
      continue
    }
    throw new Error(`Unknown doctor argument: ${argument}`)
  }

  if (!provider) {
    throw new Error(`Choose a provider with --provider ${SUPPORTED_HARNESSES.join('|')}`)
  }
  if (!(SUPPORTED_HARNESSES as readonly string[]).includes(provider)) {
    throw new Error(
      `Unsupported provider '${provider}'. Choose one of: ${SUPPORTED_HARNESSES.join(', ')}`,
    )
  }
  return provider as SupportedHarness
}

export async function runRemoteDoctor(
  provider: SupportedHarness,
  environment: DoctorEnvironment,
): Promise<DoctorReport> {
  const findings: DoctorFinding[] = []

  if (environment.platform === 'linux' && ['arm64', 'x64'].includes(environment.arch)) {
    findings.push({
      name: 'Platform',
      status: 'ok',
      detail: `Linux ${environment.arch} is in the remote preview target matrix.`,
    })
  } else {
    findings.push({
      name: 'Platform',
      status: 'error',
      detail: `${environment.platform} ${environment.arch} is outside the remote preview target matrix.`,
      remedy:
        environment.platform === 'linux' && ['arm', 'ia32'].includes(environment.arch)
          ? 'Install a 64-bit Linux image; 32-bit Raspberry Pi installations are unsupported.'
          : 'Use 64-bit Linux on arm64 or x64 for this source-deployment preview.',
    })
  }

  const nodeRange = parseNodeRange(environment.manifest.engines.node)
  const nodeVersion = parseVersion(environment.nodeVersion)
  const pinnedNodeVersion = parseVersion(environment.manifest.devEngines.runtime.version)
  const below = nodeRange ? parseVersion(nodeRange.belowExclusive) : null
  const nodeOkay =
    nodeRange !== null &&
    nodeVersion !== null &&
    pinnedNodeVersion !== null &&
    below !== null &&
    satisfiesMinimum(environment.nodeVersion, nodeRange.minimum) &&
    compareVersions(nodeVersion, below) < 0 &&
    compareVersions(nodeVersion, pinnedNodeVersion) === 0
  findings.push(
    nodeOkay
      ? {
          name: 'Node.js',
          status: 'ok',
          detail: `${environment.nodeVersion} matches the repository pin ${environment.manifest.devEngines.runtime.version}.`,
        }
      : {
          name: 'Node.js',
          status: 'error',
          detail: `${environment.nodeVersion} does not match the repository pin ${environment.manifest.devEngines.runtime.version} (${environment.manifest.engines.node}).`,
          remedy: `Use Node.js ${environment.manifest.devEngines.runtime.version} before continuing.`,
        },
  )

  const pnpmPin = parsePnpmPin(environment.manifest.packageManager)
  const pnpm = await environment.run('pnpm', ['--version'])
  const actualPnpm = parseVersion(pnpm.output)
  const expectedPnpm = pnpmPin ? parseVersion(pnpmPin) : null
  const pnpmOkay =
    pnpm.found &&
    pnpm.succeeded &&
    actualPnpm !== null &&
    expectedPnpm !== null &&
    compareVersions(actualPnpm, expectedPnpm) === 0
  findings.push(
    pnpmOkay
      ? { name: 'pnpm', status: 'ok', detail: `${pnpm.output.trim()} matches ${pnpmPin}.` }
      : {
          name: 'pnpm',
          status: 'error',
          detail: pnpm.found
            ? `Found ${pnpm.output.trim() || 'an unreadable version'}; expected ${pnpmPin ?? 'a valid repository pin'}.`
            : 'pnpm was not found.',
          remedy: `Enable the repository-pinned pnpm ${pnpmPin ?? ''} before continuing.`.trim(),
        },
  )

  const dependencyFindings = await runtimeDependencyFindings(environment)
  for (const finding of dependencyFindings) {
    findings.push({
      name: finding.name,
      status: finding.status === 'ok' ? 'ok' : 'error',
      detail: finding.detail,
      ...(finding.remedy ? { remedy: finding.remedy } : {}),
    })
  }
  findings.push(await doltAuthorIdentityFinding(environment))

  const authResult =
    provider === 'codex'
      ? await environment.run('codex', ['login', 'status'])
      : await environment.run('claude', ['auth', 'status', '--json'])
  findings.push(providerAuthFinding(provider, authResult))
  findings.push({
    name: 'Memory',
    status: 'info',
    detail: `${formatGiB(environment.totalMemoryBytes)} total; measured for diagnostics, not used as a support gate.`,
  })
  findings.push({
    name: 'Storage',
    status: 'info',
    detail: `${formatGiB(environment.freeDiskBytes)} free in the deployment filesystem; measured for diagnostics, not used as a support gate.`,
  })

  return {
    ok: findings.every((finding) => finding.status !== 'error'),
    provider,
    findings,
  }
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [`Factoru remote preview preflight (${report.provider})`]
  for (const finding of report.findings) {
    lines.push(`[${finding.status.toUpperCase()}] ${finding.name}: ${finding.detail}`)
    if (finding.remedy) lines.push(`  Remedy: ${finding.remedy}`)
  }
  lines.push(report.ok ? 'Preflight passed.' : 'Preflight failed.')
  return lines.join('\n')
}
