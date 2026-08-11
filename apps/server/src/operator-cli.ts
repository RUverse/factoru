import fs from 'node:fs'
import path from 'node:path'
import { FactoruDatabase } from '@factoru/database'
import {
  GasCityAdapter,
  GasCityError,
  SupervisorClient,
  type ReadinessFinding,
} from '@factoru/gas-city'
import { createFactoruClient, type HealthResponse } from '@factoru/protocol'
import type { ServerConfig } from './config.js'
import { readServerId } from './identity.js'
import { SERVER_VERSION } from './version.js'

export interface OperatorActivity {
  readonly kind: 'planning' | 'queue_reconciliation' | 'delivery'
  readonly factoruId: string
  readonly projectId: string
  readonly projectName: string
  readonly taskTitle: string | null
  readonly runtimeId: string | null
  readonly status: string
  readonly stage: string | null
  readonly startedAt: string | null
  readonly updatedAt: string
}

interface ActivityRow {
  kind: OperatorActivity['kind']
  factoru_id: string
  project_id: string
  project_name: string
  task_title: string | null
  runtime_id: string | null
  status: string
  stage: string | null
  started_at: string | null
  updated_at: string
}

function activityFromRow(row: ActivityRow): OperatorActivity {
  return {
    kind: row.kind,
    factoruId: row.factoru_id,
    projectId: row.project_id,
    projectName: row.project_name,
    taskTitle: row.task_title,
    runtimeId: row.runtime_id,
    status: row.status,
    stage: row.stage,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  }
}

export function serverUrlFor(config: ServerConfig): string {
  return `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`
}

export async function listOperatorActivity(
  config: ServerConfig,
  activeOnly: boolean,
): Promise<OperatorActivity[]> {
  const serverId = await readServerId(config.dataDir)
  if (!serverId || !fs.existsSync(config.databaseFile)) return []
  const database = new FactoruDatabase(config.databaseFile, serverId)
  try {
    const active = activeOnly ? "WHERE status IN ('pending', 'running', 'cancelling')" : ''
    const rows = database.connection
      .prepare(
        `SELECT * FROM (
           SELECT 'planning' AS kind, pp.id AS factoru_id, pp.project_id,
             p.name AS project_name, NULL AS task_title, pp.run_id AS runtime_id,
             pp.status, NULL AS stage, pp.started_at,
             COALESCE(pp.finished_at, pp.started_at, pp.requested_at) AS updated_at
           FROM planner_probes pp JOIN projects p ON p.id = pp.project_id
           UNION ALL
           SELECT 'queue_reconciliation' AS kind, qr.id AS factoru_id, qr.project_id,
             p.name AS project_name, NULL AS task_title, qr.run_id AS runtime_id,
             qr.status, NULL AS stage, qr.started_at,
             COALESCE(qr.finished_at, qr.started_at, qr.requested_at) AS updated_at
           FROM queue_reconciliations qr JOIN projects p ON p.id = qr.project_id
           UNION ALL
           SELECT 'delivery' AS kind, tr.id AS factoru_id, tr.project_id,
             p.name AS project_name, t.title AS task_title, tr.run_id AS runtime_id,
             tr.status, tr.stage, tr.started_at,
             COALESCE(tr.updated_at, tr.finished_at, tr.started_at, tr.created_at) AS updated_at
           FROM task_runs tr
           JOIN projects p ON p.id = tr.project_id
           JOIN tasks t ON t.id = tr.task_id
           WHERE tr.kind = 'implementation'
         ) ${active}
         ORDER BY updated_at DESC LIMIT 100`,
      )
      .all() as ActivityRow[]
    return rows.map(activityFromRow)
  } finally {
    database.close()
  }
}

export interface OperatorStatus {
  readonly version: string
  readonly serverId: string | null
  readonly serverUrl: string
  readonly dataDir: string
  readonly database: 'ready' | 'missing'
  readonly city: { readonly name: string | null; readonly state: 'ready' | 'missing' | 'partial' }
  readonly process: 'running' | 'stopped'
  readonly health: HealthResponse | null
  readonly healthError: string | null
  readonly activeActivity: readonly OperatorActivity[]
}

export async function readOperatorStatus(config: ServerConfig): Promise<OperatorStatus> {
  const serverId = await readServerId(config.dataDir)
  const cityFile = fs.existsSync(path.join(config.gasCityPath, 'city.toml'))
  const packFile = fs.existsSync(path.join(config.gasCityPath, 'pack.toml'))
  let health: HealthResponse | null = null
  let healthError: string | null = null
  try {
    health = await createFactoruClient({
      baseUrl: serverUrlFor(config),
      clientName: 'factoru-server-cli',
      clientVersion: SERVER_VERSION,
      timeoutMs: 1_500,
    }).health()
  } catch (error) {
    healthError = error instanceof Error ? error.message : String(error)
  }
  return {
    version: SERVER_VERSION,
    serverId,
    serverUrl: serverUrlFor(config),
    dataDir: config.dataDir,
    database: fs.existsSync(config.databaseFile) ? 'ready' : 'missing',
    city: {
      name: serverId ? `factoru-${serverId.slice(4, 16)}` : null,
      state: cityFile && packFile ? 'ready' : cityFile || packFile ? 'partial' : 'missing',
    },
    process: health ? 'running' : 'stopped',
    health,
    healthError,
    activeActivity: await listOperatorActivity(config, true),
  }
}

function line(label: string, value: string | number): string {
  return `  ${label.padEnd(16)}${value}`
}

export function renderOperatorStatus(status: OperatorStatus): string {
  const lines = [
    'Factoru Server status',
    line('process', status.process),
    line('version', status.version),
    line('server id', status.serverId ?? 'not initialized'),
    line('server URL', status.serverUrl),
    line('data directory', status.dataDir),
    line('database', status.database),
    line('Gas City', `${status.city.state}${status.city.name ? ` (${status.city.name})` : ''}`),
    line('active work', status.activeActivity.length),
  ]
  if (status.health) {
    lines.push(line('health', `${status.health.status}; uptime ${status.health.uptimeMs} ms`))
  } else if (status.healthError) {
    lines.push(line('health', `unreachable (${status.healthError})`))
  }
  return lines.join('\n')
}

export function renderOperatorActivity(activity: readonly OperatorActivity[]): string {
  if (activity.length === 0) return 'No matching Factoru orchestration activity.'
  return [
    'Factoru-correlated orchestration activity',
    ...activity.map((item) => {
      const subject = item.taskTitle ? `${item.projectName} / ${item.taskTitle}` : item.projectName
      return `  ${item.status.padEnd(11)} ${item.kind.padEnd(22)} ${subject} (${item.runtimeId ?? item.factoruId})`
    }),
    '',
    'Provider-native sessions not correlated to Factoru work are intentionally not enumerated.',
  ].join('\n')
}

function gasCityAdapter(config: ServerConfig, serverId: string): GasCityAdapter {
  return new GasCityAdapter({
    client: new SupervisorClient({ baseUrl: config.gasCitySupervisorUrl, timeoutMs: 3_000 }),
    cityName: `factoru-${serverId.slice(4, 16)}`,
    probe: async () => ({ found: true, output: 'operator provider check' }),
  })
}

export function configuredProvidersFromCityToml(source: string): string[] {
  const providers: string[] = []
  const pattern = /^\s*\[providers\.([a-zA-Z0-9_-]+)\]\s*(?:#.*)?$/gm
  for (const match of source.matchAll(pattern)) {
    if (match[1]) providers.push(match[1])
  }
  return [...new Set(providers)]
}

export async function readProviderFindings(
  config: ServerConfig,
  providers?: readonly string[],
): Promise<{ readonly ready: boolean; readonly findings: readonly ReadinessFinding[] }> {
  const serverId = await readServerId(config.dataDir)
  if (!serverId) {
    return {
      ready: false,
      findings: [
        {
          name: 'Factoru city',
          status: 'missing',
          detail: 'Factoru Server has not been initialized.',
          remedy: 'Run factoru-server providers configure --provider codex (or claude).',
        },
      ],
    }
  }
  let selectedProviders = providers
  if (!selectedProviders) {
    const cityFile = path.join(config.gasCityPath, 'city.toml')
    if (fs.existsSync(cityFile)) {
      selectedProviders = configuredProvidersFromCityToml(fs.readFileSync(cityFile, 'utf8'))
    }
    if (!selectedProviders || selectedProviders.length === 0) {
      return {
        ready: false,
        findings: [
          {
            name: 'Factoru city providers',
            status: 'missing',
            detail: `No explicit [providers.<name>] entries were found in ${cityFile}.`,
            remedy: 'Repair the trusted Gas City provider catalog, then retry.',
          },
        ],
      }
    }
  }
  try {
    return await gasCityAdapter(config, serverId).checkProviderReadiness(selectedProviders)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ready: false,
      findings: [
        {
          name: 'Gas City supervisor',
          status:
            error instanceof GasCityError && error.kind === 'not_found'
              ? 'missing'
              : 'needs_attention',
          detail,
          remedy: `Start the Factoru city at ${config.gasCityPath}, then retry.`,
        },
      ],
    }
  }
}

export function renderProviderFindings(result: {
  readonly ready: boolean
  readonly findings: readonly ReadinessFinding[]
}): string {
  return [
    'Factoru provider readiness',
    ...result.findings.flatMap((finding) => {
      const lines = [
        `[${finding.status === 'ok' ? 'OK' : 'ERROR'}] ${finding.name}: ${finding.detail}`,
      ]
      if (finding.remedy) lines.push(`  Remedy: ${finding.remedy}`)
      return lines
    }),
    result.ready ? 'Providers are ready.' : 'Provider readiness failed.',
  ].join('\n')
}
