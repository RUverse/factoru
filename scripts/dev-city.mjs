#!/usr/bin/env node
/** Explicitly bootstraps this worktree's development Gas City city. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { devEnvFor, resolveWorktreeRoot } from './worktree-env.mjs'

const SAFE_PROVIDER = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const SERVER_ID = /^srv_[0-9a-f]{32}$/

export function parseDevelopmentCityArgs(argv) {
  const providers = []
  let defaultProvider = null
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--provider' || argument === '--default-provider') {
      const value = argv[index + 1]?.trim()
      if (!value || !SAFE_PROVIDER.test(value)) {
        throw new Error(
          `${argument} requires a provider name containing only letters, digits, _ or -`,
        )
      }
      if (argument === '--provider') providers.push(value)
      else defaultProvider = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  const uniqueProviders = [...new Set(providers)]
  if (uniqueProviders.length === 0) {
    throw new Error('Choose at least one provider with --provider <name>')
  }
  defaultProvider ??= uniqueProviders[0]
  if (!uniqueProviders.includes(defaultProvider)) {
    throw new Error('--default-provider must also be supplied with --provider')
  }
  return { providers: uniqueProviders, defaultProvider }
}

export function developmentCityCommands(input) {
  const commands = []
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

function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${executable} ${args[0]} failed with status ${result.status}`)
}

export function main(argv = process.argv.slice(2)) {
  const selection = parseDevelopmentCityArgs(argv)
  const worktreeRoot = resolveWorktreeRoot()
  const dev = devEnvFor(worktreeRoot)
  const serverIdFile = path.join(dev.dataDir, 'server-id')
  if (!fs.existsSync(serverIdFile)) {
    throw new Error(
      'Development server identity is missing; run pnpm dev once before pnpm dev:city',
    )
  }
  const serverId = fs.readFileSync(serverIdFile, 'utf8').trim()
  if (!SERVER_ID.test(serverId)) throw new Error('Development server identity is malformed')
  const cityPath = dev.env.FACTORU_GAS_CITY_PATH
  const packFile = path.join(cityPath, 'pack.toml')
  const cityFile = path.join(cityPath, 'city.toml')
  const packExists = fs.existsSync(packFile)
  const cityExists = fs.existsSync(cityFile)
  if (packExists !== cityExists) {
    throw new Error(
      `Development city is partially initialized at ${cityPath}; inspect it before retrying`,
    )
  }
  const factoruImportExists =
    packExists && /^\[imports\.factoru\]\s*$/m.test(fs.readFileSync(packFile, 'utf8'))
  const commands = developmentCityCommands({
    ...selection,
    cityName: `factoru-${serverId.slice(4, 16)}`,
    cityPath,
    factoruPackPath: path.join(worktreeRoot, 'packs/factoru-default'),
    cityExists: packExists,
    factoruImportExists,
  })
  for (const args of commands) run('gc', args, worktreeRoot)
  console.log(`Factoru development city is ready at ${cityPath}`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
