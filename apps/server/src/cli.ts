import path from 'node:path'

export const SUPPORTED_CLI_PROVIDERS = ['codex', 'claude'] as const
export type CliProvider = (typeof SUPPORTED_CLI_PROVIDERS)[number]

export type CliCommand =
  | { readonly kind: 'start' }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'doctor'; readonly provider: CliProvider }
  | { readonly kind: 'status'; readonly json: boolean }
  | { readonly kind: 'sessions'; readonly activeOnly: boolean; readonly json: boolean }
  | {
      readonly kind: 'providers-configure'
      readonly providers: readonly CliProvider[]
      readonly defaultProvider: CliProvider
    }
  | { readonly kind: 'providers-list'; readonly json: boolean }
  | { readonly kind: 'repositories-check'; readonly url: string; readonly json: boolean }
  | {
      readonly kind: 'pair'
      readonly sshHost: string | undefined
      readonly localPort: number
      readonly json: boolean
    }
  | { readonly kind: 'backup'; readonly destination: string }

function parseProvider(raw: string | undefined, flag: string): CliProvider {
  if (!raw || !SUPPORTED_CLI_PROVIDERS.includes(raw as CliProvider)) {
    throw new Error(`${flag} requires codex or claude`)
  }
  return raw as CliProvider
}

function parseJsonOnly(args: readonly string[], usage: string): boolean {
  let json = false
  for (const argument of args) {
    if (argument === '--') continue
    if (argument === '--json') json = true
    else throw new Error(`${usage}\nUnknown argument: ${argument}`)
  }
  return json
}

function parseProviderConfiguration(
  args: readonly string[],
): Extract<CliCommand, { kind: 'providers-configure' }> {
  const providers: CliProvider[] = []
  let defaultProvider: CliProvider | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === '--provider') {
      providers.push(parseProvider(args[index + 1], '--provider'))
      index += 1
      continue
    }
    if (argument === '--default-provider') {
      defaultProvider = parseProvider(args[index + 1], '--default-provider')
      index += 1
      continue
    }
    throw new Error(
      'Usage: factoru-server providers configure --provider <codex|claude> [--provider ...] [--default-provider <name>]\n' +
        `Unknown argument: ${argument}`,
    )
  }
  const unique = [...new Set(providers)]
  if (unique.length === 0) {
    throw new Error('Choose at least one provider with --provider codex or --provider claude')
  }
  const selectedDefault = defaultProvider ?? unique[0]!
  if (!unique.includes(selectedDefault)) {
    throw new Error('--default-provider must also be supplied with --provider')
  }
  return { kind: 'providers-configure', providers: unique, defaultProvider: selectedDefault }
}

function parsePair(args: readonly string[]): Extract<CliCommand, { kind: 'pair' }> {
  let sshHost: string | undefined
  let localPort = 18_787
  let json = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === '--json') {
      json = true
      continue
    }
    if (argument === '--ssh-host') {
      const value = args[index + 1]?.trim()
      if (!value || !/^[a-zA-Z0-9._~@:-]+$/.test(value)) {
        throw new Error('--ssh-host must be a host or user@host without whitespace or shell syntax')
      }
      sshHost = value
      index += 1
      continue
    }
    if (argument === '--local-port') {
      const raw = args[index + 1]
      const value = raw && /^\d+$/.test(raw) ? Number(raw) : Number.NaN
      if (!Number.isInteger(value) || value < 1 || value > 65_535) {
        throw new Error('--local-port must be an integer between 1 and 65535')
      }
      localPort = value
      index += 1
      continue
    }
    throw new Error(
      'Usage: factoru-server pair [--ssh-host user@host] [--local-port 18787] [--json]\n' +
        `Unknown argument: ${argument}`,
    )
  }
  return { kind: 'pair', sshHost, localPort, json }
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  const args = argv.filter((argument, index) => argument !== '--' || index !== 0)
  const command = args[0]
  if (!command || command === 'start') {
    if (args.length > (command ? 1 : 0)) throw new Error('Usage: factoru-server start')
    return { kind: 'start' }
  }
  if (command === 'help' || command === '--help' || command === '-h') return { kind: 'help' }
  if (command === 'version' || command === '--version' || command === '-V') {
    return { kind: 'version' }
  }
  if (command === 'doctor') {
    let provider: CliProvider | undefined
    for (let index = 1; index < args.length; index += 1) {
      if (args[index] === '--') continue
      if (args[index] !== '--provider' || provider) {
        throw new Error('Usage: factoru-server doctor --provider <codex|claude>')
      }
      provider = parseProvider(args[index + 1], '--provider')
      index += 1
    }
    if (!provider) throw new Error('Usage: factoru-server doctor --provider <codex|claude>')
    return { kind: 'doctor', provider }
  }
  if (command === 'status') {
    return {
      kind: 'status',
      json: parseJsonOnly(args.slice(1), 'Usage: factoru-server status [--json]'),
    }
  }
  if (command === 'sessions') {
    let activeOnly = false
    let json = false
    for (const argument of args.slice(1)) {
      if (argument === '--') continue
      if (argument === '--active') activeOnly = true
      else if (argument === '--json') json = true
      else
        throw new Error(
          `Usage: factoru-server sessions [--active] [--json]\nUnknown argument: ${argument}`,
        )
    }
    return { kind: 'sessions', activeOnly, json }
  }
  if (command === 'providers') {
    const subcommand = args[1]
    if (subcommand === 'configure') return parseProviderConfiguration(args.slice(2))
    if (subcommand === 'list' || subcommand === 'check') {
      return {
        kind: 'providers-list',
        json: parseJsonOnly(args.slice(2), 'Usage: factoru-server providers list [--json]'),
      }
    }
    throw new Error(
      'Usage: factoru-server providers <configure|list>\n' +
        'Run factoru-server help for examples.',
    )
  }
  if (command === 'repositories') {
    if (args[1] !== 'check') {
      throw new Error('Usage: factoru-server repositories check --url <repository-url> [--json]')
    }
    let url: string | undefined
    let json = false
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index]
      if (argument === '--json') {
        json = true
        continue
      }
      if (argument === '--url' && !url) {
        url = args[index + 1]?.trim()
        index += 1
        continue
      }
      throw new Error('Usage: factoru-server repositories check --url <repository-url> [--json]')
    }
    if (!url) {
      throw new Error('Usage: factoru-server repositories check --url <repository-url> [--json]')
    }
    return { kind: 'repositories-check', url, json }
  }
  if (command === 'pair') return parsePair(args.slice(1))
  if (command === 'backup') {
    const destination = args[1]
    if (!destination || args.length !== 2) {
      throw new Error('Usage: factoru-server backup <absolute-destination>')
    }
    if (!path.isAbsolute(destination)) throw new Error('Backup destination must be absolute')
    return { kind: 'backup', destination }
  }
  throw new Error(`Unknown command: ${command}\nRun factoru-server help for usage.`)
}

export function renderCliHelp(): string {
  return `Factoru Server operator CLI

Usage: factoru-server <command> [options]

Commands:
  start                              Run Server in the foreground (default)
  status [--json]                    Show identity, endpoint, health, city, and activity
  providers configure --provider P   Initialize the dedicated city with codex/claude
  providers list [--json]            Check configured provider readiness
  repositories check --url U [--json]
                                     Verify non-interactive Git access as the Server user
  sessions [--active] [--json]       Show Factoru-correlated orchestration activity
  pair [--ssh-host H] [--local-port P] [--json]
                                     Create a 10-minute code and SSH connection details
  doctor --provider P                Read-only host and provider preflight
  backup <absolute-destination>       Create and integrity-check a SQLite backup
  version                            Print the Server version
  help                               Show this help

Provider authentication remains provider-owned: run codex login or claude auth login.
Git authentication remains server-user-owned; see docs/git-authentication.md.
Project model slots are configured in Factoru Desktop after pairing.`
}
