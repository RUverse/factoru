import { describe, expect, it } from 'vitest'

import { REQUIRED_DEPENDENCIES } from './compatibility.js'
import {
  checkDependencies,
  evaluateDependency,
  evaluateProviderReadiness,
  isReady,
  providerReadinessSchema,
} from './readiness.js'

const specFor = (command: string) => REQUIRED_DEPENDENCIES.find((s) => s.command === command)!

describe('evaluateDependency', () => {
  it('accepts a dependency at or above its floor', () => {
    const finding = evaluateDependency(specFor('dolt'), {
      found: true,
      output: 'dolt version 2.2.3',
    })

    expect(finding.status).toBe('ok')
    expect(finding.remedy).toBeUndefined()
  })

  it('rejects Dolt below the documented floor', () => {
    const finding = evaluateDependency(specFor('dolt'), {
      found: true,
      output: 'dolt version 2.0.5',
    })

    expect(finding.status).toBe('unsupported_version')
    expect(finding.remedy).toContain('2.1.0')
  })

  it('reports a missing dependency with an actionable remedy', () => {
    const finding = evaluateDependency(specFor('flock'), { found: false, output: '' })

    expect(finding.status).toBe('missing')
    expect(finding.remedy).toContain('brew install gascity')
  })

  it('accepts a tool with no floor as long as it exists', () => {
    // tmux is required but Gas City documents no minimum, so Factoru does not
    // invent one and present it as a requirement.
    expect(evaluateDependency(specFor('tmux'), { found: true, output: 'tmux 3.7b' }).status).toBe(
      'ok',
    )
  })

  it('range-checks gc rather than only floor-checking it', () => {
    // A newer minor may have changed the API contract, so it is not treated as
    // an automatic improvement.
    expect(evaluateDependency(specFor('gc'), { found: true, output: '1.4.0' }).status).toBe('ok')
    expect(evaluateDependency(specFor('gc'), { found: true, output: '1.4.9' }).status).toBe('ok')

    const newerMinor = evaluateDependency(specFor('gc'), { found: true, output: '1.5.0' })
    expect(newerMinor.status).toBe('unsupported_version')
    expect(newerMinor.remedy).toContain('feasibility gate')
  })
})

describe('checkDependencies', () => {
  it('reports every dependency independently rather than stopping at the first failure', async () => {
    const findings = await checkDependencies(async (command) => {
      if (command === 'dolt') return { found: false, output: '' }
      // gc is range-checked, so it needs a version inside the supported range
      // rather than an arbitrarily high one.
      if (command === 'gc') return { found: true, output: '1.4.0' }
      return { found: true, output: '99.0.0' }
    })

    expect(findings).toHaveLength(REQUIRED_DEPENDENCIES.length)
    expect(findings.filter((f) => f.status !== 'ok')).toHaveLength(1)
    expect(isReady(findings)).toBe(false)
  })
})

describe('evaluateProviderReadiness', () => {
  // Captured verbatim from GET /v0/city/{city}/provider-readiness on 1.4.0.
  const report = providerReadinessSchema.parse({
    providers: {
      claude: {
        display_name: 'Claude Code',
        status: 'needs_auth',
        detail: 'claude is installed but not logged in',
      },
      codex: { display_name: 'Codex', status: 'configured' },
      gemini: {
        display_name: 'Gemini CLI',
        status: 'not_installed',
        detail: 'gemini executable not found in probe PATH',
      },
    },
  })

  it('treats an unauthenticated harness as needing attention, not as missing', () => {
    const [claude] = evaluateProviderReadiness(report, ['claude'])

    // The distinction matters: the software is installed and the fix is a login
    // only the user can perform, so Factoru must not tell them to reinstall.
    expect(claude?.status).toBe('needs_attention')
    expect(claude?.remedy).toContain('Log in')
  })

  it('accepts a configured harness', () => {
    expect(evaluateProviderReadiness(report, ['codex'])[0]?.status).toBe('ok')
  })

  it('reports an uninstalled harness as missing', () => {
    expect(evaluateProviderReadiness(report, ['gemini'])[0]?.status).toBe('missing')
  })

  it('reports a harness Gas City has never heard of', () => {
    const [finding] = evaluateProviderReadiness(report, ['cursor'])

    expect(finding?.status).toBe('missing')
    expect(finding?.detail).toContain('cursor')
  })
})
