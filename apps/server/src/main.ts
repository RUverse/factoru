#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto'
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
import { configureCity, reconcileFactoruPack } from './city-bootstrap.js'
import { parseCliArgs, renderCliHelp } from './cli.js'
import { loadServerConfig } from './config.js'
import { ensureServerId, readServerId } from './identity.js'
import { ProjectService } from './project-service.js'
import { RepositoryError, RepositoryService } from './repositories.js'
import { SERVER_VERSION } from './version.js'
import { WorkspaceService } from './workspace-service.js'
import { TaskService } from './task-service.js'
import { AgentToolService } from './agent-tool-service.js'
import { GAS_CITY_CALLBACK_BASE_PATH } from './gas-city-callback.js'
import { writeLocalEnrollmentFile } from './local-enrollment.js'
import { CapsuleService } from './capsule-service.js'
import { ArtifactService } from './artifact-service.js'
import { renderDoctorReport, runRemoteDoctor, systemDoctorEnvironment } from './doctor.js'
import {
  listOperatorActivity,
  configuredProvidersFromCityToml,
  readOperatorStatus,
  readProviderFindings,
  renderOperatorActivity,
  renderOperatorStatus,
  renderProviderFindings,
  serverUrlFor,
} from './operator-cli.js'

const execFileAsync = promisify(execFile)

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function pairingCode(): string {
  const bytes = randomBytes(12)
  const characters = [...bytes].map((byte) => CROCKFORD[byte % CROCKFORD.length]!).join('')
  return `${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8, 12)}`
}

async function main(): Promise<void> {
  const command = parseCliArgs(process.argv.slice(2))

  if (command.kind === 'help') {
    console.log(renderCliHelp())
    return
  }
  if (command.kind === 'version') {
    console.log(SERVER_VERSION)
    return
  }
  if (command.kind === 'doctor') {
    const environment = await systemDoctorEnvironment()
    const report = await runRemoteDoctor(command.provider, environment)
    console.log(renderDoctorReport(report))
    let runtimeOkay = true
    const doctorConfig = loadServerConfig()
    const doctorServerId = await readServerId(doctorConfig.dataDir)
    const doctorCityFile = path.join(doctorConfig.gasCityPath, 'city.toml')
    if (doctorServerId && fs.existsSync(doctorCityFile)) {
      const runtime = new GasCityAdapter({
        client: new SupervisorClient({ baseUrl: doctorConfig.gasCitySupervisorUrl }),
        cityName: `factoru-${doctorServerId.slice(4, 16)}`,
        probe: async (executable, args) => {
          const result = await environment.run(executable, args)
          return { found: result.found, output: result.output }
        },
      })
      const providers = configuredProvidersFromCityToml(fs.readFileSync(doctorCityFile, 'utf8'))
      const readiness = await runtime.checkReadiness(providers)
      const contract = await runtime.verifySupervisorContract().catch((error: unknown) => ({
        ok: false,
        missingPaths: [error instanceof Error ? error.message : String(error)],
      }))
      runtimeOkay = readiness.ready && contract.ok
      console.log('')
      console.log('Factoru Gas City runtime')
      for (const finding of readiness.findings) {
        console.log(
          `[${finding.status === 'ok' ? 'OK' : 'ERROR'}] ${finding.name}: ${finding.detail}`,
        )
        if (finding.remedy) console.log(`  Remedy: ${finding.remedy}`)
      }
      console.log(
        contract.ok
          ? '[OK] Served supervisor contract contains every Factoru operation.'
          : `[ERROR] Served supervisor contract is missing: ${contract.missingPaths.join(', ')}`,
      )
    }
    if (!report.ok || !runtimeOkay) process.exitCode = 1
    return
  }

  const config = loadServerConfig()

  if (command.kind === 'repositories-check') {
    try {
      const result = await new RepositoryService(
        config.repositoryRoots,
        config.projectsRoot,
      ).checkRemoteAccess(command.url)
      if (command.json) {
        console.log(JSON.stringify({ ready: true, ...result }, null, 2))
      } else {
        console.log('Factoru repository access')
        console.log(`  transport       ${result.transport}`)
        console.log(`  host            ${result.host}`)
        console.log('  access          ready')
      }
    } catch (error) {
      if (!(error instanceof RepositoryError)) throw error
      if (command.json) {
        console.log(
          JSON.stringify(
            { ready: false, error: { code: error.code, message: error.message } },
            null,
            2,
          ),
        )
      } else {
        console.log('Factoru repository access')
        console.log(`  access          failed (${error.code})`)
        console.log(`  remedy          ${error.message}`)
      }
      process.exitCode = 1
    }
    return
  }

  if (command.kind === 'status') {
    const status = await readOperatorStatus(config)
    console.log(command.json ? JSON.stringify(status, null, 2) : renderOperatorStatus(status))
    if (status.process !== 'running') process.exitCode = 1
    return
  }

  if (command.kind === 'sessions') {
    const activity = await listOperatorActivity(config, command.activeOnly)
    console.log(command.json ? JSON.stringify(activity, null, 2) : renderOperatorActivity(activity))
    return
  }

  if (command.kind === 'providers-list') {
    const result = await readProviderFindings(config)
    console.log(command.json ? JSON.stringify(result, null, 2) : renderProviderFindings(result))
    if (!result.ready) process.exitCode = 1
    return
  }

  const serverId = await ensureServerId(config.dataDir)

  if (command.kind === 'providers-configure') {
    const configured = await configureCity(
      config,
      serverId,
      command.providers,
      command.defaultProvider,
    )
    const result = await readProviderFindings(config, command.providers)
    console.log(
      `${configured.created ? 'Initialized' : 'Retained'} Factoru city ${configured.cityName} at ${config.gasCityPath}.`,
    )
    if (!configured.created) {
      console.log(
        'Existing trusted provider configuration was not rewritten; requested providers were verified instead.',
      )
    }
    console.log(renderProviderFindings(result))
    if (!result.ready) process.exitCode = 1
    return
  }

  const database = new FactoruDatabase(config.databaseFile, serverId)

  if (command.kind === 'pair') {
    const code = pairingCode()
    const expiresAt = new Date(Date.now() + 10 * 60_000)
    database.createPairingCode(code, expiresAt)
    const desktopUrl = `http://127.0.0.1:${command.localPort}`
    const sshCommand = command.sshHost
      ? `ssh -N -L ${command.localPort}:127.0.0.1:${config.port} ${command.sshHost}`
      : null
    const result = {
      serverId,
      code,
      expiresAt: expiresAt.toISOString(),
      serverUrl: serverUrlFor(config),
      desktopUrl,
      sshCommand,
    }
    if (command.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log('Factoru Desktop pairing')
      console.log(`  Server ID       ${serverId}`)
      console.log(`  Pairing code    ${code}`)
      console.log(`  Expires         ${result.expiresAt}`)
      console.log(`  Desktop URL     ${desktopUrl}`)
      if (sshCommand) console.log(`  SSH tunnel      ${sshCommand}`)
      else console.log('  SSH tunnel      rerun with --ssh-host user@server to print the command')
    }
    database.close()
    return
  }

  if (command.kind === 'backup') {
    const destination = command.destination
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

  const repositories = new RepositoryService(config.repositoryRoots, config.projectsRoot)
  const serverUrl = serverUrlFor(config)
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
    probe: async (command, versionArgs) => {
      try {
        const result = await execFileAsync(command, [...versionArgs], {
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
    formulaSource: async (formulaName) => {
      if (!/^[a-z0-9-]+$/.test(formulaName)) {
        throw new Error(`Invalid Factoru formula name: ${formulaName}`)
      }
      return fs.promises.readFile(
        path.join(config.factoruPackPath, 'formulas', `${formulaName}.toml`),
        'utf8',
      )
    },
  })
  let orchestrationReady = true
  const orchestrationDiagnostics: string[] = []
  if (command.kind === 'start') {
    const runtimeCityFile = path.join(config.gasCityPath, 'city.toml')
    const configuredProviders = fs.existsSync(runtimeCityFile)
      ? configuredProvidersFromCityToml(fs.readFileSync(runtimeCityFile, 'utf8'))
      : []
    if (!fs.existsSync(runtimeCityFile)) {
      orchestrationDiagnostics.push(
        `Factoru Gas City is not initialized at ${config.gasCityPath}. Run providers configure first.`,
      )
    }
    const readiness = await gasCity.checkReadiness(configuredProviders)
    for (const finding of readiness.findings) {
      if (finding.status !== 'ok') {
        orchestrationDiagnostics.push(
          `${finding.name}: ${finding.detail}${finding.remedy ? ` Remedy: ${finding.remedy}` : ''}`,
        )
      }
    }
    try {
      const contract = await gasCity.verifySupervisorContract()
      if (!contract.ok) {
        orchestrationDiagnostics.push(
          `Gas City supervisor contract is missing: ${contract.missingPaths.join(', ')}`,
        )
      }
    } catch (error) {
      orchestrationDiagnostics.push(
        `Gas City supervisor contract could not be verified: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    orchestrationReady = readiness.ready && orchestrationDiagnostics.length === 0
    if (orchestrationReady) {
      const rigs = database
        .listProjects()
        .flatMap((project) => project.repositories)
        .filter((repository) => repository.rig.registrationState === 'ready')
        .map((repository) => ({ name: repository.rig.rigName }))
      try {
        await reconcileFactoruPack(config, rigs)
      } catch (error) {
        orchestrationReady = false
        orchestrationDiagnostics.push(
          `Factoru pack/configuration reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  const artifactService = new ArtifactService(database, config.artifactDirectory)
  const workspaceService = new WorkspaceService(
    database,
    gasCity,
    new GasCityProjectConfigurator({
      cityPath: config.gasCityPath,
      factoruServerUrl: serverUrl,
      gasCitySupervisorUrl: config.gasCitySupervisorUrl,
      cityName,
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
    {
      capsules: new CapsuleService(path.join(config.dataDir, 'capsules')),
      artifacts: artifactService,
      serverOrigin: serverUrl,
      cityName,
      packLockDigest: createHash('sha256')
        .update(fs.readFileSync(path.join(config.factoruPackPath, 'packs.lock')))
        .digest('hex'),
      // Gas City owns the provider-specific `/publish` suffix.
      conversationCallbackUrl: `${serverUrl}${GAS_CITY_CALLBACK_BASE_PATH}`,
      orchestrationEnabled: orchestrationReady,
    },
  )
  const app = buildServer({
    serverId,
    logLevel: config.logLevel,
    trustProxy: config.trustLoopbackProxy,
    database,
    projectService,
    workspaceService,
    artifactService,
    taskService: new TaskService(database),
    agentToolService: new AgentToolService(database),
    localEnrollmentProof: localEnrollment.proof,
  })
  if (!orchestrationReady) {
    app.log.error(
      { findings: orchestrationDiagnostics },
      'Gas City orchestration is paused; Factoru product history remains available',
    )
  }

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
  console.error('[factoru-server] error:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
