import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { developmentCityCommands, parseDevelopmentCityArgs } from './dev-city.mjs'

describe('development city provider selection', () => {
  it('requires an explicit provider and defaults to the first selected provider', () => {
    assert.deepEqual(parseDevelopmentCityArgs(['--provider', 'codex']), {
      providers: ['codex'],
      defaultProvider: 'codex',
    })
    assert.throws(() => parseDevelopmentCityArgs([]), /Choose at least one provider/)
  })

  it('supports several providers with one explicit default', () => {
    assert.deepEqual(
      parseDevelopmentCityArgs([
        '--provider',
        'claude',
        '--provider',
        'codex',
        '--default-provider',
        'codex',
      ]),
      { providers: ['claude', 'codex'], defaultProvider: 'codex' },
    )
    assert.throws(
      () => parseDevelopmentCityArgs(['--provider', 'claude', '--default-provider', 'codex']),
      /must also be supplied/,
    )
  })
})

describe('development city bootstrap commands', () => {
  const input = {
    providers: ['codex'],
    defaultProvider: 'codex',
    cityName: 'factoru-111111111111',
    cityPath: '/tmp/factoru/city',
    factoruPackPath: '/worktree/packs/factoru-default',
    cityExists: false,
    factoruImportExists: false,
  }

  it('initializes, pins the Factoru pack, installs imports, and starts safely', () => {
    const commands = developmentCityCommands(input)
    assert.deepEqual(commands[0], [
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
    assert.deepEqual(commands[1], [
      'import',
      'add',
      '/worktree/packs/factoru-default',
      '--name',
      'factoru',
      '--city',
      '/tmp/factoru/city',
    ])
    assert.deepEqual(commands.at(-1), ['start', '/tmp/factoru/city', '--no-auto-restart'])
  })

  it('adopts an initialized city without rewriting it or re-adding its pack', () => {
    assert.deepEqual(
      developmentCityCommands({ ...input, cityExists: true, factoruImportExists: true }),
      [
        ['import', 'install', '--city', '/tmp/factoru/city'],
        ['start', '/tmp/factoru/city', '--no-auto-restart'],
      ],
    )
  })
})
