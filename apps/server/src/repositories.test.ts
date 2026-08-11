import { describe, expect, it } from 'vitest'
import { RepositoryService, type GitCommandRunner } from './repositories.js'

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
    const service = new RepositoryService([], runner)

    await expect(service.checkRemoteAccess(url)).resolves.toEqual({
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
    const service = new RepositoryService([], runner)

    await expect(
      service.checkRemoteAccess('ssh://git@github.com/RUverse/factoru.git'),
    ).resolves.toMatchObject({ transport: 'ssh' })
    await expect(
      service.checkRemoteAccess('https://token@github.com/RUverse/factoru.git'),
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
    const service = new RepositoryService([], runner)

    let failure: (Error & { code: string }) | undefined
    try {
      await service.checkRemoteAccess('git@github.com:owner/repository.git')
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
    const missing = new RepositoryService([], async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    })
    await expect(missing.checkRemoteAccess('https://example.com/repo.git')).rejects.toMatchObject({
      code: 'git_unavailable',
    })

    const timeout = new RepositoryService([], async () => {
      throw Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' })
    })
    await expect(timeout.checkRemoteAccess('https://example.com/repo.git')).rejects.toMatchObject({
      code: 'repository_access_timeout',
    })
  })
})
