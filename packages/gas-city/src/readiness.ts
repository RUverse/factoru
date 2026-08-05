import { z } from 'zod'

import {
  GAS_CITY_SUPPORTED_RANGE,
  REQUIRED_DEPENDENCIES,
  type DependencySpec,
} from './compatibility.js'
import { satisfiesMinimum, withinRange } from './version.js'

/**
 * Factoru's own readiness view of the Gas City runtime.
 *
 * Server readiness is deliberately several independent facts rather than one
 * boolean. A failed orchestration dependency must never make a user's project
 * and task history unavailable — Factoru can be perfectly healthy while Gas
 * City is not, and the UI has to be able to say which.
 */

export type ReadinessStatus =
  /** Present and within the supported range. */
  | 'ok'
  /** Present but outside the version Factoru verified against. */
  | 'unsupported_version'
  /** Not installed, or not on the path Factoru probes. */
  | 'missing'
  /** Installed but not usable yet — typically a harness that needs a login. */
  | 'needs_attention'

export interface ReadinessFinding {
  readonly name: string
  readonly status: ReadinessStatus
  /** What Factoru observed, for display and for logs. */
  readonly detail: string
  /**
   * What the user should do. Present whenever the status is not `ok`, because a
   * readiness failure the user cannot act on is just an error message.
   */
  readonly remedy: string | undefined
}

/** Result of probing one executable. */
export interface ProbeResult {
  readonly found: boolean
  /** Raw `--version` output, whatever format the tool uses. */
  readonly output: string
}

/** Probes an executable. Injected so readiness logic is testable without a shell. */
export type CommandProbe = (command: string) => Promise<ProbeResult>

/** Evaluate one dependency against its spec. */
export function evaluateDependency(spec: DependencySpec, probe: ProbeResult): ReadinessFinding {
  if (!probe.found) {
    return {
      name: spec.displayName,
      status: 'missing',
      detail: `${spec.command} was not found.`,
      remedy: `Install it. On macOS and Linux, 'brew install gascity' installs Gas City and this dependency together. ${spec.reason}`,
    }
  }

  // `gc` itself is range-checked rather than floor-checked: a newer minor may
  // have changed the API contract Factoru was verified against, so it is not
  // automatically an improvement.
  if (spec.command === 'gc') {
    if (!withinRange(probe.output, GAS_CITY_SUPPORTED_RANGE)) {
      return {
        name: spec.displayName,
        status: 'unsupported_version',
        detail: `Found ${probe.output.trim() || 'an unreadable version'}; Factoru is verified against >=${GAS_CITY_SUPPORTED_RANGE.minimum} and <${GAS_CITY_SUPPORTED_RANGE.belowExclusive}.`,
        remedy: `Install Gas City ${GAS_CITY_SUPPORTED_RANGE.minimum}. A different minor version has not been through Factoru's feasibility gate.`,
      }
    }
    return okFinding(spec, probe)
  }

  if (spec.minimumVersion !== null && !satisfiesMinimum(probe.output, spec.minimumVersion)) {
    return {
      name: spec.displayName,
      status: 'unsupported_version',
      detail: `Found ${probe.output.trim() || 'an unreadable version'}; Factoru requires ${spec.minimumVersion} or newer.`,
      remedy: `Upgrade ${spec.command} to ${spec.minimumVersion} or newer. ${spec.reason}`,
    }
  }

  return okFinding(spec, probe)
}

function okFinding(spec: DependencySpec, probe: ProbeResult): ReadinessFinding {
  return {
    name: spec.displayName,
    status: 'ok',
    detail: probe.output.trim() || 'present',
    remedy: undefined,
  }
}

/** Probe every required dependency and report each one independently. */
export async function checkDependencies(probe: CommandProbe): Promise<ReadinessFinding[]> {
  return Promise.all(
    REQUIRED_DEPENDENCIES.map(async (spec) => evaluateDependency(spec, await probe(spec.command))),
  )
}

/**
 * The supervisor's own provider-readiness report.
 *
 * Gas City refuses to create a city whose declared providers are not ready, so
 * this is a precondition for provisioning and not merely diagnostic. Observed
 * statuses include `configured`, `needs_auth`, and `not_installed`.
 */
export const providerReadinessSchema = z.object({
  providers: z.record(
    z.string(),
    z.object({
      display_name: z.string().optional(),
      status: z.string(),
      detail: z.string().optional(),
    }),
  ),
})

/**
 * Translate Gas City's provider report into Factoru findings.
 *
 * A harness that needs a login is `needs_attention`, not `missing`: the user
 * has installed it and the fix is a login they must perform themselves.
 */
export function evaluateProviderReadiness(
  report: z.infer<typeof providerReadinessSchema>,
  requiredHarnesses: readonly string[],
): ReadinessFinding[] {
  return requiredHarnesses.map((harness) => {
    const provider = report.providers[harness]
    const name = provider?.display_name ?? harness

    if (!provider) {
      return {
        name,
        status: 'missing' as const,
        detail: `Gas City does not know about a '${harness}' provider.`,
        remedy: `Declare '${harness}' in the city's provider configuration.`,
      }
    }

    if (provider.status === 'configured') {
      return { name, status: 'ok' as const, detail: 'configured', remedy: undefined }
    }

    if (provider.status === 'needs_auth') {
      return {
        name,
        status: 'needs_attention' as const,
        detail: provider.detail ?? `${harness} is installed but not logged in.`,
        // Factoru never performs this login: it is the user's credential, and
        // the server must not hold or replay it.
        remedy: `Log in to ${name} in a terminal on the server host, then re-check readiness.`,
      }
    }

    return {
      name,
      status: 'missing' as const,
      detail: provider.detail ?? provider.status,
      remedy: `Install and configure ${name} on the server host.`,
    }
  })
}

/** Whether every finding permits Factoru to proceed. */
export function isReady(findings: readonly ReadinessFinding[]): boolean {
  return findings.every((finding) => finding.status === 'ok')
}
