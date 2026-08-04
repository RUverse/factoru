import { buildServer } from './app.js'
import { loadServerConfig } from './config.js'
import { ensureServerId } from './identity.js'
import { SERVER_VERSION } from './version.js'

async function main(): Promise<void> {
  const config = loadServerConfig()
  const serverId = await ensureServerId(config.dataDir)

  const app = buildServer({ serverId, logLevel: config.logLevel })

  const shutdown = (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'shutting down')
    void app.close().then(
      () => process.exit(0),
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
