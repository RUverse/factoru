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
    await new GasCityRigRegistrar(executor).register({
      cityPath: '/factoru/city',
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
        '/factoru/city',
      ],
      ['gc', 'import', 'install', '--city', '/factoru/city'],
      ['gc', 'reload', '--city', '/factoru/city'],
    ])
  })

  it('blocks a staged path before invoking Gas City', async () => {
    const calls: string[][] = []
    const target = repository()
    fs.writeFileSync(path.join(target, 'staged.txt'), 'user work')
    execFileSync('git', ['add', 'staged.txt'], { cwd: target })
    await expect(
      new GasCityRigRegistrar({
        async run(executable, args) {
          calls.push([executable, ...args])
          return { stdout: '', stderr: '' }
        },
      }).register({
        cityPath: '/factoru/city',
        repositoryPath: target,
        rigName: 'factoru-project',
        beadPrefix: 'f1234567',
        defaultBranch: 'dev',
      }),
    ).rejects.toThrow(/staged change/)
    expect(calls).toEqual([])
  })
})
