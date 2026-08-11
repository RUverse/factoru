import { describe, expect, it } from 'vitest'
import type { DoctorEnvironment, ExecutableResult } from './doctor.js'
import { parseDoctorArgs, runRemoteDoctor } from './doctor.js'

const REQUIRED_OUTPUTS: Record<string, string> = {
  pnpm: '11.20.0',
  gc: '1.4.0',
  dolt: 'dolt version 2.1.0',
  bd: 'bd version 1.1.2',
  tmux: 'tmux 3.5',
  git: 'git version 2.50.0',
  jq: 'jq-1.7.1',
  flock: 'flock from util-linux 2.40.0',
  codex: 'Logged in using ChatGPT',
  claude: '{"loggedIn":true,"authMethod":"claude.ai"}',
}

function environment(
  overrides: Partial<Omit<DoctorEnvironment, 'run'>> & {
    outputs?: Record<string, ExecutableResult>
    onRun?: (command: string, args: readonly string[]) => void
  } = {},
): DoctorEnvironment {
  const outputs = overrides.outputs ?? {}
  return {
    platform: overrides.platform ?? 'linux',
    arch: overrides.arch ?? 'arm64',
    nodeVersion: overrides.nodeVersion ?? 'v22.13.0',
    totalMemoryBytes: overrides.totalMemoryBytes ?? 8 * 1024 ** 3,
    freeDiskBytes: overrides.freeDiskBytes ?? 64 * 1024 ** 3,
    manifest: overrides.manifest ?? {
      engines: { node: '>=22.13.0 <23' },
      devEngines: { runtime: { name: 'node', version: '22.13.0' } },
      packageManager: 'pnpm@11.20.0',
    },
    async run(command, args) {
      overrides.onRun?.(command, args)
      const override = outputs[command]
      if (override) return override
      const output = REQUIRED_OUTPUTS[command]
      return output
        ? { found: true, succeeded: true, output }
        : { found: false, succeeded: false, output: `${command} was not found` }
    },
  }
}

describe('remote preview doctor', () => {
  it.each(['arm64', 'x64'])('accepts 64-bit Linux on %s', async (arch) => {
    const report = await runRemoteDoctor('codex', environment({ arch }))
    expect(report.ok).toBe(true)
    expect(report.findings).toContainEqual(
      expect.objectContaining({ name: 'Platform', status: 'ok' }),
    )
  })

  it.each([
    ['linux', 'arm', /64-bit Linux image/],
    ['linux', 'ia32', /64-bit Linux image/],
    ['darwin', 'arm64', /64-bit Linux on arm64 or x64/],
  ] as const)('rejects %s %s', async (platform, arch, remedy) => {
    const report = await runRemoteDoctor('codex', environment({ platform, arch }))
    expect(report.ok).toBe(false)
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        name: 'Platform',
        status: 'error',
        remedy: expect.stringMatching(remedy),
      }),
    )
  })

  it.each([
    ['v22.13.0', true],
    ['v22.99.0', false],
    ['v22.12.9', false],
    ['v23.0.0', false],
  ] as const)('checks Node %s against the repository range', async (nodeVersion, ok) => {
    const report = await runRemoteDoctor('codex', environment({ nodeVersion }))
    expect(report.findings.find((finding) => finding.name === 'Node.js')?.status).toBe(
      ok ? 'ok' : 'error',
    )
  })

  it('fails when a required executable is missing', async () => {
    const report = await runRemoteDoctor(
      'codex',
      environment({
        outputs: { jq: { found: false, succeeded: false, output: 'not found' } },
      }),
    )
    expect(report.ok).toBe(false)
    expect(report.findings).toContainEqual(expect.objectContaining({ name: 'jq', status: 'error' }))
  })

  it('probes dependency versions with their supported CLI syntax', async () => {
    const calls: Array<[string, readonly string[]]> = []
    const report = await runRemoteDoctor(
      'codex',
      environment({ onRun: (command, args) => calls.push([command, args]) }),
    )

    expect(report.ok).toBe(true)
    expect(calls).toContainEqual(['gc', ['version']])
    expect(calls).toContainEqual(['dolt', ['version']])
    expect(calls).toContainEqual(['bd', ['version']])
    expect(calls).toContainEqual(['tmux', ['-V']])
  })

  it('requires the repository-pinned pnpm version', async () => {
    const report = await runRemoteDoctor(
      'codex',
      environment({
        outputs: { pnpm: { found: true, succeeded: true, output: '11.19.0' } },
      }),
    )
    expect(report.ok).toBe(false)
    expect(report.findings).toContainEqual(
      expect.objectContaining({ name: 'pnpm', status: 'error' }),
    )
  })

  it.each([
    ['gc', '1.5.0'],
    ['dolt', 'dolt version 2.0.9'],
    ['bd', 'bd version 1.1.1'],
  ] as const)('fails when %s is outside Factoru compatibility', async (command, output) => {
    const report = await runRemoteDoctor(
      'codex',
      environment({ outputs: { [command]: { found: true, succeeded: true, output } } }),
    )
    expect(report.ok).toBe(false)
  })

  it('fails when Codex is installed but unauthenticated', async () => {
    const report = await runRemoteDoctor(
      'codex',
      environment({
        outputs: {
          codex: { found: true, succeeded: false, output: 'Not logged in' },
        },
      }),
    )
    expect(report.ok).toBe(false)
    expect(report.findings).toContainEqual(
      expect.objectContaining({ name: 'codex authentication', status: 'error' }),
    )
  })

  it('fails when the selected provider CLI is missing', async () => {
    const report = await runRemoteDoctor(
      'claude',
      environment({
        outputs: {
          claude: { found: false, succeeded: false, output: 'not found' },
        },
      }),
    )
    expect(report.ok).toBe(false)
    expect(report.findings).toContainEqual(
      expect.objectContaining({ name: 'claude authentication', status: 'error' }),
    )
  })

  it('parses Claude authentication status', async () => {
    const report = await runRemoteDoctor('claude', environment())
    expect(report.ok).toBe(true)
    expect(report.findings).toContainEqual(
      expect.objectContaining({ name: 'claude authentication', status: 'ok' }),
    )
  })

  it('requires one supported provider argument', () => {
    expect(parseDoctorArgs(['--provider', 'codex'])).toBe('codex')
    expect(parseDoctorArgs(['--', '--provider', 'claude'])).toBe('claude')
    expect(() => parseDoctorArgs([])).toThrow(/Choose a provider/)
    expect(() => parseDoctorArgs(['--provider', 'gemini'])).toThrow(/Unsupported provider/)
    expect(() => parseDoctorArgs(['--provider', 'codex', '--provider', 'claude'])).toThrow(
      /only once/,
    )
  })
})
