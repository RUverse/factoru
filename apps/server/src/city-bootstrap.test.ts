import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cityBootstrapCommands,
  ensureCityRepositoryBoundary,
  factoruPackReconcileCommands,
  hasFactoruImport,
  isExistingFactoruImportFailure,
} from './city-bootstrap.js'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

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

  it('gives a nested development city its own repository discovery boundary', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-city-parent-'))
    directories.push(parent)
    execFileSync('git', ['init', '-b', 'dev', parent])
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/factoru.git'], {
      cwd: parent,
    })
    const cityPath = path.join(parent, '.factoru-dev', 'city')

    await expect(ensureCityRepositoryBoundary(cityPath)).resolves.toBe(true)
    await expect(ensureCityRepositoryBoundary(cityPath)).resolves.toBe(false)
    expect(fs.lstatSync(path.join(cityPath, '.git')).isDirectory()).toBe(true)
    expect(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: cityPath,
        encoding: 'utf8',
      }).trim(),
    ).toBe(fs.realpathSync(cityPath))
    expect(execFileSync('git', ['remote'], { cwd: cityPath, encoding: 'utf8' })).toBe('')
    expect(
      execFileSync('git', ['log', '-1', '--format=%s'], { cwd: cityPath, encoding: 'utf8' }).trim(),
    ).toBe('Initialize Factoru city boundary')
    expect(execFileSync('git', ['ls-files'], { cwd: cityPath, encoding: 'utf8' })).toBe('')
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
      ['import', 'check', '--city', '/tmp/factoru/city'],
      ['config', 'show', '--validate', '--city', '/tmp/factoru/city'],
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
      ['import', 'check', '--city', '/tmp/factoru/city'],
      ['config', 'show', '--validate', '--city', '/tmp/factoru/city'],
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
