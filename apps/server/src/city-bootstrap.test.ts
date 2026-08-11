import { describe, expect, it } from 'vitest'
import { cityBootstrapCommands } from './city-bootstrap.js'

describe('Factoru city bootstrap', () => {
  const input = {
    providers: ['codex'] as const,
    defaultProvider: 'codex' as const,
    cityName: 'factoru-111111111111',
    cityPath: '/tmp/factoru/city',
    factoruPackPath: '/worktree/packs/factoru-default',
    cityExists: false,
    factoruImportExists: false,
  }

  it('initializes the selected providers and installs the Factoru pack', () => {
    const commands = cityBootstrapCommands(input)
    expect(commands[0]).toEqual([
      'init',
      '--template',
      'gascity',
      '--providers',
      'codex',
      '--default-provider',
      'codex',
      '--name',
      'factoru-111111111111',
      '--no-start',
      '--yes',
      '/tmp/factoru/city',
    ])
    expect(commands[1]).toEqual([
      'import',
      'add',
      '/worktree/packs/factoru-default',
      '--name',
      'factoru',
      '--city',
      '/tmp/factoru/city',
    ])
    expect(commands.at(-1)).toEqual(['start', '/tmp/factoru/city', '--no-auto-restart'])
  })

  it('adopts an existing city without rewriting its trusted provider config', () => {
    expect(
      cityBootstrapCommands({ ...input, cityExists: true, factoruImportExists: true }),
    ).toEqual([
      ['import', 'install', '--city', '/tmp/factoru/city'],
      ['start', '/tmp/factoru/city', '--no-auto-restart'],
    ])
  })
})
