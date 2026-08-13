import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { GasCityRigRegistrar, type CommandExecutor } from './registration.js'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

function repository(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-rig-'))
  directories.push(directory)
  execFileSync('git', ['init', '-b', 'dev'], { cwd: directory })
  execFileSync('git', ['config', 'user.email', 'test@factoru.local'], { cwd: directory })
  execFileSync('git', ['config', 'user.name', 'Factoru Test'], { cwd: directory })
  fs.writeFileSync(path.join(directory, 'README.md'), '# Test\n')
  execFileSync('git', ['add', 'README.md'], { cwd: directory })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: directory })
  return directory
}

function city(version = 'sha:1111111111111111111111111111111111111111'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-city-'))
  directories.push(directory)
  fs.writeFileSync(
    path.join(directory, 'pack.toml'),
    `[imports.factoru]\nsource = "file:///factoru//packs/factoru-default"\nversion = "${version}"\n`,
  )
  return directory
}

describe('GasCityRigRegistrar', () => {
  it('enforces registration order and explicit identity values', async () => {
    const calls: string[][] = []
    const executor: CommandExecutor = {
      async run(executable, args) {
        calls.push([executable, ...args])
        return { stdout: '', stderr: '' }
      },
    }
    const target = repository()
    const cityPath = city()
    await new GasCityRigRegistrar(executor).register({
      cityPath,
      repositoryPath: target,
      rigName: 'factoru-project',
      beadPrefix: 'f1234567',
      defaultBranch: 'dev',
    })
    expect(calls).toEqual([
      [
        'gc',
        'rig',
        'add',
        target,
        '--name',
        'factoru-project',
        '--prefix',
        'f1234567',
        '--default-branch',
        'dev',
        '--city',
        cityPath,
      ],
      [
        'gc',
        'import',
        'add',
        'file:///factoru//packs/factoru-default',
        '--version',
        'sha:1111111111111111111111111111111111111111',
        '--name',
        'factoru',
        '--rig',
        'factoru-project',
        '--city',
        cityPath,
      ],
      ['gc', 'import', 'install', '--city', cityPath],
      ['gc', 'import', 'check', '--city', cityPath],
      ['gc', 'config', 'show', '--validate', '--city', cityPath],
      ['gc', 'reload', '--city', cityPath],
    ])
  })

  it('attaches a non-git Factoru pack without inventing a version', async () => {
    const calls: string[][] = []
    const cityPath = city()
    fs.writeFileSync(
      path.join(cityPath, 'pack.toml'),
      '[imports.factoru]\nsource = "/opt/factoru/pack"\n',
    )
    await new GasCityRigRegistrar({
      async run(executable, args) {
        calls.push([executable, ...args])
        return { stdout: '', stderr: '' }
      },
    }).register({
      cityPath,
      repositoryPath: repository(),
      rigName: 'factoru-project',
      beadPrefix: 'f1234567',
      defaultBranch: 'dev',
    })
    expect(calls[1]).toEqual([
      'gc',
      'import',
      'add',
      '/opt/factoru/pack',
      '--name',
      'factoru',
      '--rig',
      'factoru-project',
      '--city',
      cityPath,
    ])
  })

  it('blocks a staged path before invoking Gas City', async () => {
    const calls: string[][] = []
    const target = repository()
    const cityPath = city()
    fs.writeFileSync(path.join(target, 'staged.txt'), 'user work')
    execFileSync('git', ['add', 'staged.txt'], { cwd: target })
    await expect(
      new GasCityRigRegistrar({
        async run(executable, args) {
          calls.push([executable, ...args])
          return { stdout: '', stderr: '' }
        },
      }).register({
        cityPath,
        repositoryPath: target,
        rigName: 'factoru-project',
        beadPrefix: 'f1234567',
        defaultBranch: 'dev',
      }),
    ).rejects.toThrow(/staged change/)
    expect(calls).toEqual([])
  })

  it('unstages only known Gas City files when recovering a managed clone', async () => {
    const calls: string[][] = []
    const target = repository()
    const cityPath = city()
    fs.mkdirSync(path.join(target, '.beads'))
    fs.writeFileSync(path.join(target, '.beads', 'config.yaml'), 'database: partial\n')
    fs.appendFileSync(path.join(target, '.gitignore'), '.beads/*\n!.beads/config.yaml\n')
    execFileSync('git', ['add', '.beads/config.yaml', '.gitignore'], { cwd: target })

    await new GasCityRigRegistrar({
      async run(executable, args) {
        calls.push([executable, ...args])
        return { stdout: '', stderr: '' }
      },
    }).register({
      cityPath,
      repositoryPath: target,
      rigName: 'factoru-project',
      beadPrefix: 'f1234567',
      defaultBranch: 'dev',
      recoverPartialManagedSetup: true,
    })

    expect(
      execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: target, encoding: 'utf8' }),
    ).toBe('')
    expect(calls[0]?.slice(0, 3)).toEqual(['gc', 'rig', 'add'])
  })

  it('never unstages unrelated user work during managed recovery', async () => {
    const target = repository()
    const cityPath = city()
    fs.mkdirSync(path.join(target, '.beads'))
    fs.writeFileSync(path.join(target, '.beads', 'config.yaml'), 'database: partial\n')
    fs.writeFileSync(path.join(target, 'user-work.txt'), 'keep staged\n')
    execFileSync('git', ['add', '.beads/config.yaml', 'user-work.txt'], { cwd: target })

    await expect(
      new GasCityRigRegistrar({
        run: async () => ({ stdout: '', stderr: '' }),
      }).register({
        cityPath,
        repositoryPath: target,
        rigName: 'factoru-project',
        beadPrefix: 'f1234567',
        defaultBranch: 'dev',
        recoverPartialManagedSetup: true,
      }),
    ).rejects.toThrow(/staged change/)
    expect(
      execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: target, encoding: 'utf8' }),
    ).toContain('user-work.txt')
  })
})
