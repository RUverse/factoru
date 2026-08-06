import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { FactoruDatabase } from '@factoru/database'
import {
  GasCityAdapter,
  GasCityProjectConfigurator,
  GasCityRigRegistrar,
  SupervisorClient,
} from '@factoru/gas-city'
import { buildServer } from './app.js'
import { loadServerConfig } from './config.js'
import { ensureServerId } from './identity.js'
import { ProjectService } from './project-service.js'
import { RepositoryService } from './repositories.js'
import { SERVER_VERSION } from './version.js'
import { WorkspaceService } from './workspace-service.js'
import { TaskService } from './task-service.js'
import { AgentToolService } from './agent-tool-service.js'
import { writeLocalEnrollmentFile } from './local-enrollment.js'

const execFileAsync = promisify(execFile)

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function pairingCode(): string {
  const bytes = randomBytes(12)
  const characters = [...bytes].map((byte) => CROCKFORD[byte % CROCKFORD.length]!).join('')
  return `${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8, 12)}`
}

async function main(): Promise<void> {
  const config = loadServerConfig()
  const serverId = await ensureServerId(config.dataDir)
  const database = new FactoruDatabase(config.databaseFile, serverId)

  if (process.argv[2] === 'pair') {
    const code = pairingCode()
    database.createPairingCode(code, new Date(Date.now() + 10 * 60_000))
    console.log(code)
    database.close()
    return
  }

  if (process.argv[2] === 'backup') {
    const destination = process.argv[3]
    if (!destination) throw new Error('Usage: factoru-server backup <absolute-destination>')
    if (!path.isAbsolute(destination)) throw new Error('Backup destination must be absolute')
    if (fs.existsSync(destination)) throw new Error('Backup destination already exists')
    await database.backup(destination)
    const restored = new FactoruDatabase(destination, serverId)
    const integrity = restored.connection.pragma('integrity_check', { simple: true })
    restored.close()
    if (integrity !== 'ok') throw new Error(`Backup verification failed: ${String(integrity)}`)
    database.close()
    console.log(`Factoru database backed up to ${destination}`)
    return
  }

  const repositories = new RepositoryService(config.repositoryRoots)
  const serverUrl = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`
  const localEnrollment = writeLocalEnrollmentFile(config.localEnrollmentFile, {
    serverId,
    serverUrl,
  })
  const cityName = `factoru-${serverId.slice(4, 16)}`
  const projectService = new ProjectService({
    database,
    repositories,
    registrar: new GasCityRigRegistrar(),
    cityName,
    cityPath: config.gasCityPath,
  })
  const gasCity = new GasCityAdapter({
    client: new SupervisorClient({ baseUrl: config.gasCitySupervisorUrl }),
    cityName,
    probe: async (command) => {
      try {
        const result = await execFileAsync(command, ['--version'], {
          timeout: 10_000,
          encoding: 'utf8',
        })
        return { found: true, output: `${result.stdout}${result.stderr}` }
      } catch (error) {
        const missing =
          typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
        return {
          found: !missing,
          output: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })
  const workspaceService = new WorkspaceService(
    database,
    gasCity,
    new GasCityProjectConfigurator({
      cityPath: config.gasCityPath,
      factoruServerUrl: serverUrl,
      projectManagerPromptPath: path.join(
        config.factoruPackPath,
        'agents/project-manager-chat/prompt.template.md',
      ),
      executor: {
        async run(executable, args, cwd) {
          const result = await execFileAsync(executable, [...args], {
            cwd,
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
          })
          return { stdout: result.stdout, stderr: result.stderr }
        },
      },
    }),
  )
  const app = buildServer({
    serverId,
    logLevel: config.logLevel,
    trustProxy: config.trustLoopbackProxy,
    database,
    projectService,
    workspaceService,
    taskService: new TaskService(database),
    agentToolService: new AgentToolService(database),
    localEnrollmentProof: localEnrollment.proof,
  })

  const shutdown = (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'shutting down')
    void app.close().then(
      () => {
        database.close()
        process.exit(0)
      },
      (error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed')
        process.exit(1)
      },
    )
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  await app.listen({ host: config.host, port: config.port })
  app.log.info(
    {
      serverId,
      serverVersion: SERVER_VERSION,
      dataDir: config.dataDir,
      url: serverUrl,
    },
    'Factoru Server is listening',
  )
}

main().catch((error: unknown) => {
  console.error('[factoru-server] failed to start:', error)
  process.exitCode = 1
})
