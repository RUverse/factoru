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

/** Recognize the import layouts Gas City may normalize into pack.toml. */
export function hasFactoruImport(source: string): boolean {
  let section: 'none' | 'imports' | 'import-entry' = 'none'
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^\[imports\.(?:factoru|"factoru"|'factoru')\](?:\s*#.*)?$/.test(line)) return true
    if (/^\[imports\](?:\s*#.*)?$/.test(line)) {
      section = 'imports'
      continue
    }
    if (/^\[\[imports\]\](?:\s*#.*)?$/.test(line)) {
      section = 'import-entry'
      continue
    }
    if (/^\[/.test(line)) {
      section = 'none'
      continue
    }
    if (section === 'imports' && /^factoru\s*=/.test(line)) return true
    if (section === 'import-entry' && /^name\s*=\s*["']factoru["']/.test(line)) return true
  }
  return false
}

function commandFailureText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const record = error as Record<string, unknown>
  const fields = ['message', 'stdout', 'stderr'] as const
  return fields
    .map((field) => (field in record ? String(record[field]) : ''))
    .filter(Boolean)
    .join('\n')
}

export function isExistingFactoruImportFailure(args: readonly string[], error: unknown): boolean {
  return (
    args[0] === 'import' &&
    args[1] === 'add' &&
    args.includes('--name') &&
    args[args.indexOf('--name') + 1] === 'factoru' &&
    /import ["']factoru["'] already exists/i.test(commandFailureText(error))
  )
}

interface FactoruPackReconcileInput {
  readonly cityPath: string
  readonly factoruPackPath: string
  readonly factoruImportExists: boolean
  readonly rigs?: readonly {
    readonly name: string
  }[]
}

export function factoruPackReconcileCommands(
  input: FactoruPackReconcileInput,
  reload: boolean,
): readonly (readonly string[])[] {
  const commands: string[][] = []
  // `gc import add` promotes a pack inside a Git worktree to a commit-pinned
  // file:// import. Remove rig bindings first: Gas City validates the combined
  // lock graph during `import add` and must never observe a new root pin beside
  // an old rig pin.
  for (const rig of input.rigs ?? []) {
    commands.push(['import', 'remove', 'factoru', '--rig', rig.name, '--city', input.cityPath])
  }
  if (input.factoruImportExists) {
    commands.push(['import', 'remove', 'factoru', '--city', input.cityPath])
  }
  commands.push([
    'import',
    'add',
    input.factoruPackPath,
    '--name',
    'factoru',
    '--city',
    input.cityPath,
  ])
  for (const rig of input.rigs ?? []) {
    commands.push([
      'import',
      'add',
      input.factoruPackPath,
      '--name',
      'factoru',
      '--rig',
      rig.name,
      '--city',
      input.cityPath,
    ])
  }
  commands.push(['import', 'install', '--city', input.cityPath])
  commands.push(['import', 'check', '--city', input.cityPath])
  commands.push(['config', 'show', '--validate', '--city', input.cityPath])
  if (reload) commands.push(['reload', '--city', input.cityPath])
  return commands
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
  commands.push(...factoruPackReconcileCommands(input, false).map((args) => [...args]))
  commands.push(['start', input.cityPath, '--no-auto-restart'])
  return commands
}

async function executeCommands(config: ServerConfig, commands: readonly (readonly string[])[]) {
  for (const args of commands) {
    try {
      await execFileAsync('gc', [...args], {
        cwd: path.dirname(config.factoruPackPath),
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      })
    } catch (error) {
      if (isExistingFactoruImportFailure(args, error)) continue
      throw new Error(
        `Gas City command failed (gc ${args.join(' ')}): ${commandFailureText(error).slice(0, 2_000)}`,
        { cause: error },
      )
    }
  }
}

/**
 * Stop Beads from discovering an unrelated repository above the managed city.
 * Development state deliberately lives below the Factoru worktree, and bd
 * otherwise treats that worktree's origin/Dolt refs as the city's remote.
 */
export async function ensureCityRepositoryBoundary(cityPath: string): Promise<boolean> {
  if (!path.isAbsolute(cityPath)) {
    throw new Error(`Gas City path must be absolute, got ${cityPath}`)
  }
  if (fs.existsSync(cityPath)) {
    const city = fs.lstatSync(cityPath)
    if (!city.isDirectory() || city.isSymbolicLink()) {
      throw new Error(`Gas City path must be a real directory: ${cityPath}`)
    }
  } else {
    fs.mkdirSync(cityPath, { recursive: true, mode: 0o700 })
  }

  const gitDirectory = path.join(cityPath, '.git')
  let changed = false
  if (fs.existsSync(gitDirectory)) {
    const marker = fs.lstatSync(gitDirectory)
    if (!marker.isDirectory() || marker.isSymbolicLink()) {
      throw new Error(`Gas City repository boundary must be a real directory: ${gitDirectory}`)
    }
  } else {
    await execFileAsync('git', ['init', '-b', 'factoru-city', cityPath], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    changed = true
  }

  try {
    await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: cityPath,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
  } catch {
    // Some Git discovery libraries skip an unborn repository and continue to
    // the parent. An empty commit makes this a complete, unambiguous boundary
    // without making Git the owner of generated city configuration.
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Factoru',
        '-c',
        'user.email=factoru@localhost',
        'commit',
        '--allow-empty',
        '-m',
        'Initialize Factoru city boundary',
      ],
      { cwd: cityPath, encoding: 'utf8', maxBuffer: 1024 * 1024 },
    )
    changed = true
  }
  return changed
}

/** Re-pin and reload the Factoru-owned root and rig packs on server start. */
export async function reconcileFactoruPack(
  config: ServerConfig,
  rigs: readonly { readonly name: string }[],
): Promise<boolean> {
  const packFile = path.join(config.gasCityPath, 'pack.toml')
  const cityFile = path.join(config.gasCityPath, 'city.toml')
  const packExists = fs.existsSync(packFile)
  const cityExists = fs.existsSync(cityFile)
  if (packExists !== cityExists) {
    throw new Error(
      `The Factoru city is partially initialized at ${config.gasCityPath}; inspect it before retrying`,
    )
  }
  if (!cityExists) return false
  await ensureCityRepositoryBoundary(config.gasCityPath)
  await executeCommands(
    config,
    factoruPackReconcileCommands(
      {
        cityPath: config.gasCityPath,
        factoruPackPath: config.factoruPackPath,
        factoruImportExists: hasFactoruImport(fs.readFileSync(packFile, 'utf8')),
        rigs: rigs.map((rig) => ({ name: rig.name })),
      },
      true,
    ),
  )
  return true
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
  const factoruImportExists = packExists && hasFactoruImport(fs.readFileSync(packFile, 'utf8'))
  await ensureCityRepositoryBoundary(config.gasCityPath)
  const commands = cityBootstrapCommands({
    providers,
    defaultProvider,
    cityName,
    cityPath: config.gasCityPath,
    factoruPackPath: config.factoruPackPath,
    cityExists,
    factoruImportExists,
  })
  // A prior attempt can add the import successfully and then fail later while
  // starting Dolt. executeCommands treats only that exact retry as idempotent.
  await executeCommands(config, commands)
  return { cityName, created: !cityExists }
}
