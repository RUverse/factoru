import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ServerId } from '@factoru/domain'
import type { ServerConfig } from './config.js'
import type { CliProvider } from './cli.js'

const execFileAsync = promisify(execFile)

export interface CityBootstrapInput {
  readonly providers: readonly CliProvider[]
  readonly defaultProvider: CliProvider
  readonly cityName: string
  readonly cityPath: string
  readonly factoruPackPath: string
  readonly cityExists: boolean
  readonly factoruImportExists: boolean
}

export function cityBootstrapCommands(input: CityBootstrapInput): readonly (readonly string[])[] {
  const commands: string[][] = []
  if (!input.cityExists) {
    commands.push([
      'init',
      '--template',
      'gascity',
      '--providers',
      input.providers.join(','),
      '--default-provider',
      input.defaultProvider,
      '--name',
      input.cityName,
      '--no-start',
      '--yes',
      input.cityPath,
    ])
  }
  if (!input.factoruImportExists) {
    commands.push([
      'import',
      'add',
      input.factoruPackPath,
      '--name',
      'factoru',
      '--city',
      input.cityPath,
    ])
  }
  commands.push(['import', 'install', '--city', input.cityPath])
  commands.push(['start', input.cityPath, '--no-auto-restart'])
  return commands
}

export async function configureCity(
  config: ServerConfig,
  serverId: ServerId,
  providers: readonly CliProvider[],
  defaultProvider: CliProvider,
): Promise<{ readonly cityName: string; readonly created: boolean }> {
  const cityName = `factoru-${serverId.slice(4, 16)}`
  const packFile = path.join(config.gasCityPath, 'pack.toml')
  const cityFile = path.join(config.gasCityPath, 'city.toml')
  const packExists = fs.existsSync(packFile)
  const cityExists = fs.existsSync(cityFile)
  if (packExists !== cityExists) {
    throw new Error(
      `The Factoru city is partially initialized at ${config.gasCityPath}; inspect it before retrying`,
    )
  }
  const factoruImportExists =
    packExists && /^\[imports\.factoru\]\s*$/m.test(fs.readFileSync(packFile, 'utf8'))
  const commands = cityBootstrapCommands({
    providers,
    defaultProvider,
    cityName,
    cityPath: config.gasCityPath,
    factoruPackPath: config.factoruPackPath,
    cityExists,
    factoruImportExists,
  })
  for (const args of commands) {
    await execFileAsync('gc', [...args], {
      cwd: path.dirname(config.factoruPackPath),
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
  }
  return { cityName, created: !cityExists }
}
