import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RepositoryService, type GitCommandRunner } from './repositories.js'

const directories: string[] = []
function service(runner: GitCommandRunner): RepositoryService {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-repositories-'))
  directories.push(directory)
  return new RepositoryService(
    [],
    { id: 'root_projects', label: 'Projects', path: directory },
    runner,
  )
}
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('repository remote access', () => {
  it.each([
    ['https://github.com/RUverse/factoru.git', 'https', 'github.com'],
    ['ssh://git@github.com/RUverse/factoru.git', 'ssh', 'github.com'],
    ['git@github-work:RUverse/factoru.git', 'ssh', 'github-work'],
  ] as const)('checks %s non-interactively', async (url, transport, host) => {
    let invocation:
      | { args: readonly string[]; environment: NodeJS.ProcessEnv; timeout: number | undefined }
      | undefined
    const runner: GitCommandRunner = async (args, options) => {
      invocation = { args, environment: options.env ?? {}, timeout: options.timeout }
      return { stdout: 'ref: refs/heads/dev\tHEAD\n', stderr: '' }
    }
    const repositories = service(runner)

    await expect(repositories.checkRemoteAccess(url)).resolves.toEqual({
      transport,
      host,
      accessible: true,
    })
    expect(invocation?.args).toEqual(['ls-remote', '--symref', '--', url, 'HEAD'])
    expect(invocation?.environment).toMatchObject({
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      SSH_ASKPASS_REQUIRE: 'never',
    })
    expect(invocation?.environment.GIT_SSH_COMMAND).toContain('BatchMode=yes')
    expect(invocation?.timeout).toBe(15_000)
  })

  it('permits an SSH username but rejects embedded HTTPS credentials', async () => {
    const runner: GitCommandRunner = async () => ({ stdout: '', stderr: '' })
    const repositories = service(runner)

    await expect(
      repositories.checkRemoteAccess('ssh://git@github.com/RUverse/factoru.git'),
    ).resolves.toMatchObject({ transport: 'ssh' })
    await expect(
      repositories.checkRemoteAccess('https://token@github.com/RUverse/factoru.git'),
    ).rejects.toMatchObject({ code: 'repository_url_contains_credentials' })
  })

  it.each([
    [
      'repository_authentication_required',
      'git@github.com: Permission denied (publickey). secret-key-name',
    ],
    ['repository_host_key_required', 'Host key verification failed. secret-fingerprint'],
    ['repository_not_found_or_forbidden', 'ERROR: Repository not found. private-owner'],
    ['repository_network_unavailable', 'ssh: Could not resolve hostname github.com: unknown host'],
  ])('classifies and sanitizes %s failures', async (code, stderr) => {
    const runner: GitCommandRunner = async () => {
      throw Object.assign(new Error('git failed with a sensitive command'), { code: 128, stderr })
    }
    const repositories = service(runner)

    let failure: (Error & { code: string }) | undefined
    try {
      await repositories.checkRemoteAccess('git@github.com:owner/repository.git')
    } catch (error) {
      failure = error as Error & { code: string }
    }
    expect(failure).toBeDefined()
    if (!failure) throw new Error('Expected repository access to fail')
    expect(failure.code).toBe(code)
    expect(failure.message).not.toContain('secret')
    expect(failure.message).not.toContain('private-owner')
    expect(failure.message).not.toContain('sensitive command')
  })

  it('classifies missing Git and bounded timeout failures', async () => {
    const missing = service(async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    })
    await expect(missing.checkRemoteAccess('https://example.com/repo.git')).rejects.toMatchObject({
      code: 'git_unavailable',
    })

    const timeout = service(async () => {
      throw Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' })
    })
    await expect(timeout.checkRemoteAccess('https://example.com/repo.git')).rejects.toMatchObject({
      code: 'repository_access_timeout',
    })
  })
})

describe('managed project destinations', () => {
  it('places every repository below a stable project folder', () => {
    const repositories = service(async () => ({ stdout: '', stderr: '' }))
    const project = repositories.planProjectDirectory(
      'prj_1234567890abcdef1234567890abcdef',
      'My Product / API',
    )
    const first = repositories.planClone('git@github-work:owner/web.git', project)
    const second = repositories.planClone('https://gitlab.com/owner/api.git', project)

    expect(project.relativePath).toBe('my-product-api-12345678')
    expect(first.repository.relativePath).toMatch(
      /^my-product-api-12345678\/repositories\/web-[a-f0-9]{8}$/,
    )
    expect(second.repository.relativePath).toMatch(
      /^my-product-api-12345678\/repositories\/api-[a-f0-9]{8}$/,
    )
    expect(path.dirname(path.dirname(first.repository.realPath))).toBe(project.realPath)
    expect(path.dirname(path.dirname(second.repository.realPath))).toBe(project.realPath)
  })
})
