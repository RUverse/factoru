import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FactoruDatabase } from '@factoru/database'
import { ensureServerId } from './identity.js'
import {
  configuredProvidersFromCityToml,
  listOperatorActivity,
  renderOperatorActivity,
  renderOperatorStatus,
  serverUrlFor,
} from './operator-cli.js'
import type { ServerConfig } from './config.js'

const config = {
  host: '127.0.0.1',
  port: 23456,
} as ServerConfig

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('operator CLI projections', () => {
  it('derives configured providers from Gas City trusted config', () => {
    expect(
      configuredProvidersFromCityToml(`
[workspace]
provider = "codex"

[providers.codex]
base = "builtin:codex"

[providers.claude] # optional second harness
base = "builtin:claude"
`),
    ).toEqual(['codex', 'claude'])
  })

  it('prints the actual configured loopback endpoint', () => {
    expect(serverUrlFor(config)).toBe('http://127.0.0.1:23456')
  })

  it('renders stopped/uninitialized status without claiming a running process', () => {
    const output = renderOperatorStatus({
      version: '0.0.0',
      serverId: null,
      serverUrl: 'http://127.0.0.1:23456',
      dataDir: '/tmp/factoru',
      projectsRoot: '/home/test/factoru-projects',
      database: 'missing',
      city: { name: null, state: 'missing' },
      process: 'stopped',
      health: null,
      healthError: 'not reachable',
      activeActivity: [],
    })
    expect(output).toContain('not initialized')
    expect(output).toContain('stopped')
    expect(output).toContain('http://127.0.0.1:23456')
    expect(output).toContain('/home/test/factoru-projects')
  })

  it('labels sessions as Factoru-correlated activity', () => {
    const output = renderOperatorActivity([
      {
        kind: 'delivery',
        factoruId: 'execution-1',
        projectId: 'project-1',
        projectName: 'Demo',
        taskTitle: 'Fix the button',
        runtimeId: 'gas-run-1',
        status: 'running',
        stage: 'implementation',
        startedAt: '2026-08-11T10:00:00.000Z',
        updatedAt: '2026-08-11T10:01:00.000Z',
      },
    ])
    expect(output).toContain('gas-run-1')
    expect(output).toContain('Provider-native sessions')
  })

  it('queries an initialized database with no activity', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'factoru-operator-cli-'))
    created.push(dataDir)
    const serverId = await ensureServerId(dataDir)
    new FactoruDatabase(path.join(dataDir, 'factoru.sqlite'), serverId).close()
    await expect(
      listOperatorActivity(
        {
          ...config,
          dataDir,
          databaseFile: path.join(dataDir, 'factoru.sqlite'),
        },
        true,
      ),
    ).resolves.toEqual([])
  })
})
