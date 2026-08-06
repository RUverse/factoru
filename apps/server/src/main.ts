import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { FactoruDatabase } from '@factoru/database'
import { GasCityRigRegistrar } from '@factoru/gas-city'
import { buildServer } from './app.js'
import { loadServerConfig } from './config.js'
import { ensureServerId } from './identity.js'
import { ProjectService } from './project-service.js'
import { RepositoryService } from './repositories.js'
import { SERVER_VERSION } from './version.js'

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
  const projectService = new ProjectService({
    database,
    repositories,
    registrar: new GasCityRigRegistrar(),
    cityName: `factoru-${serverId.slice(4, 16)}`,
    cityPath: config.gasCityPath,
  })
  const app = buildServer({
    serverId,
    logLevel: config.logLevel,
    trustProxy: config.trustLoopbackProxy,
    database,
    projectService,
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
      url: `http://${config.host}:${config.port}`,
    },
    'Factoru Server is listening',
  )
}

main().catch((error: unknown) => {
  console.error('[factoru-server] failed to start:', error)
  process.exitCode = 1
})
