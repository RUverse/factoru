import { describe, expect, it } from 'vitest'
import {
  cityBootstrapCommands,
  factoruPackReconcileCommands,
  hasFactoruImport,
  isExistingFactoruImportFailure,
} from './city-bootstrap.js'

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

  it('re-pins only the Factoru-owned import when adopting an existing city', () => {
    expect(
      cityBootstrapCommands({ ...input, cityExists: true, factoruImportExists: true }),
    ).toEqual([
      ['import', 'remove', 'factoru', '--city', '/tmp/factoru/city'],
      [
        'import',
        'add',
        '/worktree/packs/factoru-default',
        '--name',
        'factoru',
        '--city',
        '/tmp/factoru/city',
      ],
      ['import', 'install', '--city', '/tmp/factoru/city'],
      ['start', '/tmp/factoru/city', '--no-auto-restart'],
    ])
  })

  it('installs and reloads the current Factoru pack on server start', () => {
    expect(
      factoruPackReconcileCommands(
        {
          cityPath: '/tmp/factoru/city',
          factoruPackPath: '/worktree/packs/factoru-default',
          factoruImportExists: true,
          rigs: [{ name: 'factoru-project' }],
        },
        true,
      ),
    ).toEqual([
      ['import', 'remove', 'factoru', '--rig', 'factoru-project', '--city', '/tmp/factoru/city'],
      ['import', 'remove', 'factoru', '--city', '/tmp/factoru/city'],
      [
        'import',
        'add',
        '/worktree/packs/factoru-default',
        '--name',
        'factoru',
        '--city',
        '/tmp/factoru/city',
      ],
      [
        'import',
        'add',
        '/worktree/packs/factoru-default',
        '--name',
        'factoru',
        '--rig',
        'factoru-project',
        '--city',
        '/tmp/factoru/city',
      ],
      ['import', 'install', '--city', '/tmp/factoru/city'],
      ['reload', '--city', '/tmp/factoru/city'],
    ])
  })

  it('recognizes normalized Gas City import layouts', () => {
    expect(hasFactoruImport('[imports.factoru]\nsource = "/pack"\n')).toBe(true)
    expect(hasFactoruImport('[imports."factoru"]\nsource = "/pack"\n')).toBe(true)
    expect(hasFactoruImport('[imports]\nfactoru = { source = "/pack" }\n')).toBe(true)
    expect(hasFactoruImport('[[imports]]\nname = "factoru"\nsource = "/pack"\n')).toBe(true)
    expect(hasFactoruImport('[imports.other]\nsource = "/pack"\n')).toBe(false)
  })

  it('treats only the exact already-added Factoru import retry as idempotent', () => {
    const args = ['import', 'add', '/pack', '--name', 'factoru', '--city', '/city']
    expect(
      isExistingFactoruImportFailure(args, {
        stderr: 'gc import add: import already exists: import "factoru" already exists',
      }),
    ).toBe(true)
    expect(isExistingFactoruImportFailure(args, { stderr: 'permission denied' })).toBe(false)
    expect(
      isExistingFactoruImportFailure(['import', 'add', '/pack', '--name', 'other'], {
        stderr: 'import "factoru" already exists',
      }),
    ).toBe(false)
  })
})
