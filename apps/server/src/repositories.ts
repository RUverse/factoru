import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  GAS_CITY_REPOSITORY_MUTATIONS,
  parsePorcelainStatusZ,
  previewRigRegistration,
  type RepositoryStatusEntry,
} from '@factoru/gas-city'
import type { ProjectPreview } from '@factoru/protocol'
import type { RepositoryRootConfig } from './config.js'

const exec = promisify(execFile)
const REMOTE_ACCESS_TIMEOUT_MS = 15_000

export interface GitCommandOptions {
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeout?: number
  readonly maxBuffer?: number
}

export type GitCommandRunner = (
  args: readonly string[],
  options: GitCommandOptions,
) => Promise<{ stdout: string; stderr: string }>

const runGitCommand: GitCommandRunner = async (args, options) => {
  const result = await exec('git', [...args], {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    encoding: 'utf8',
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

export class RepositoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RepositoryError'
  }
}

export interface ResolvedRepository {
  root: RepositoryRootConfig
  relativePath: string
  realPath: string
}

export interface ImportedRepository {
  repository: ResolvedRepository
  sourceUrl: string
}

export interface RepositoryAccessCheck {
  readonly transport: 'ssh' | 'https'
  readonly host: string
  readonly accessible: true
}

interface ValidatedRemoteUrl {
  readonly sourceUrl: string
  readonly transport: RepositoryAccessCheck['transport']
  readonly host: string
}

export interface RepositoryEntry {
  name: string
  relativePath: string
  kind: 'directory' | 'repository'
}

export class RepositoryService {
  readonly #roots: ReadonlyMap<string, RepositoryRootConfig>
  readonly #runGit: GitCommandRunner

  constructor(roots: readonly RepositoryRootConfig[], runGit: GitCommandRunner = runGitCommand) {
    this.#roots = new Map(
      roots.map((root) => {
        const normalized = { ...root, path: fsSync.realpathSync(root.path) }
        return [normalized.id, normalized]
      }),
    )
    this.#runGit = runGit
  }

  roots(): Array<{ id: string; label: string }> {
    return [...this.#roots.values()].map(({ id, label }) => ({ id, label }))
  }

  rootLabel(rootId: string): string {
    return this.#roots.get(rootId)?.label ?? 'Repository'
  }

  async previewAbsolute(absolutePath: string): Promise<ProjectPreview> {
    if (!path.isAbsolute(absolutePath)) {
      throw new RepositoryError('repository_path_invalid', 'Choose an absolute repository folder')
    }
    const realPath = await fs.realpath(absolutePath).catch(() => null)
    if (!realPath) {
      throw new RepositoryError('repository_not_found', 'The selected folder is unavailable')
    }
    const root = [...this.#roots.values()]
      .filter(
        (candidate) =>
          realPath === candidate.path || realPath.startsWith(`${candidate.path}${path.sep}`),
      )
      .sort((left, right) => right.path.length - left.path.length)[0]
    if (!root) {
      throw new RepositoryError(
        'repository_outside_approved_roots',
        'That folder is outside this server’s approved repository locations',
      )
    }
    return (await this.preview(root.id, path.relative(root.path, realPath))).preview
  }

  async clone(urlValue: string, rootId: string): Promise<ImportedRepository> {
    const planned = this.planClone(urlValue, rootId)
    const { sourceUrl } = planned
    const root = planned.repository.root
    const relativePath = planned.repository.relativePath
    const destination = planned.repository.realPath
    if (fsSync.existsSync(destination)) {
      try {
        const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], {
          cwd: destination,
          encoding: 'utf8',
        })
        if (stdout.trim() !== sourceUrl) throw new Error('origin_mismatch')
      } catch {
        throw new RepositoryError(
          'clone_destination_exists',
          `The managed clone destination ${relativePath} is already in use`,
        )
      }
    } else {
      try {
        await this.#runGit(['clone', '--', sourceUrl, destination], {
          cwd: root.path,
          env: this.#nonInteractiveGitEnvironment(),
          maxBuffer: 4 * 1024 * 1024,
        })
      } catch (error) {
        await fs.rm(destination, { recursive: true, force: true })
        const accessError = this.#classifyAccessFailure(error, this.#validateRemoteUrl(sourceUrl))
        if (accessError.code !== 'repository_access_failed') throw accessError
        throw new RepositoryError(
          'repository_clone_failed',
          'Factoru Server could not clone the repository after access was validated. Check the factory network and available storage, then retry repository setup.',
        )
      }
    }
    return {
      repository: await this.resolve(rootId, relativePath),
      sourceUrl,
    }
  }

  async checkRemoteAccess(urlValue: string): Promise<RepositoryAccessCheck> {
    const remote = this.#validateRemoteUrl(urlValue)
    try {
      await this.#runGit(['ls-remote', '--symref', '--', remote.sourceUrl, 'HEAD'], {
        cwd: process.cwd(),
        env: this.#nonInteractiveGitEnvironment(),
        timeout: REMOTE_ACCESS_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      })
    } catch (error) {
      throw this.#classifyAccessFailure(error, remote)
    }
    return { transport: remote.transport, host: remote.host, accessible: true }
  }

  planClone(urlValue: string, rootId: string): ImportedRepository {
    const root = this.#roots.get(rootId)
    if (!root) {
      throw new RepositoryError('repository_root_not_found', 'Clone destination is unavailable')
    }
    const sourceUrl = this.#validateRemoteUrl(urlValue).sourceUrl
    const baseName = this.#remoteRepositoryName(sourceUrl)
    const suffix = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 8)
    const relativePath = `${baseName}-${suffix}`
    const destination = path.join(root.path, relativePath)
    return {
      repository: { root, relativePath, realPath: destination },
      sourceUrl,
    }
  }

  async resolve(rootId: string, relativePath: string): Promise<ResolvedRepository> {
    const root = this.#roots.get(rootId)
    if (!root)
      throw new RepositoryError('repository_root_not_found', 'Repository root is unavailable')
    if (path.isAbsolute(relativePath)) {
      throw new RepositoryError(
        'repository_path_invalid',
        'Repository path must be relative to its approved root',
      )
    }
    const normalized = path.normalize(relativePath || '.')
    if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
      throw new RepositoryError(
        'repository_path_invalid',
        'Repository path leaves its approved root',
      )
    }
    let realPath: string
    try {
      realPath = await fs.realpath(path.resolve(root.path, normalized))
    } catch {
      throw new RepositoryError(
        'repository_not_found',
        'Repository path does not exist or is inaccessible',
      )
    }
    if (realPath !== root.path && !realPath.startsWith(`${root.path}${path.sep}`)) {
      throw new RepositoryError(
        'repository_path_invalid',
        'Repository path resolves outside its approved root',
      )
    }
    return {
      root,
      relativePath: path.relative(root.path, realPath).split(path.sep).join('/'),
      realPath,
    }
  }

  async browse(rootId: string, relativePath: string): Promise<RepositoryEntry[]> {
    const directory = await this.resolve(rootId, relativePath)
    const entries = await fs.readdir(directory.realPath, { withFileTypes: true })
    const visible: RepositoryEntry[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200)) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name === '.git') continue
      const child = path.join(directory.realPath, entry.name)
      const relative = path.relative(directory.root.path, child).split(path.sep).join('/')
      visible.push({
        name: entry.name,
        relativePath: relative,
        kind: (await this.#isGitRepository(child)) ? 'repository' : 'directory',
      })
    }
    if (await this.#isGitRepository(directory.realPath)) {
      visible.unshift({
        name: path.basename(directory.realPath),
        relativePath: directory.relativePath,
        kind: 'repository',
      })
    }
    return visible
  }

  async preview(
    rootId: string,
    relativePath: string,
    requestedBranch?: string,
  ): Promise<{
    preview: ProjectPreview
    repository: ResolvedRepository
  }> {
    const repository = await this.resolve(rootId, relativePath)
    const git = async (args: string[]) =>
      (
        await exec('git', args, {
          cwd: repository.realPath,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        })
      ).stdout.trim()
    let topLevel: string
    try {
      topLevel = await git(['rev-parse', '--show-toplevel'])
    } catch {
      throw new RepositoryError(
        'not_a_repository',
        'The selected directory is not a Git repository',
      )
    }
    if ((await fs.realpath(topLevel)) !== repository.realPath) {
      throw new RepositoryError(
        'repository_not_top_level',
        'Select the top-level Git repository directory',
      )
    }
    if ((await git(['rev-parse', '--is-bare-repository'])) === 'true') {
      throw new RepositoryError('bare_repository', 'Bare repositories cannot be Factoru projects')
    }
    let detectedBranch: string
    try {
      detectedBranch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
    } catch {
      throw new RepositoryError('detached_head', 'Choose a repository with a checked-out branch')
    }
    const branches = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
      .split('\n')
      .filter(Boolean)
    const defaultBranch = requestedBranch ?? detectedBranch
    if (!branches.includes(defaultBranch)) {
      throw new RepositoryError('branch_not_found', `Local branch ${defaultBranch} does not exist`)
    }
    const { stdout: statusOutput } = await exec(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: repository.realPath, encoding: 'buffer', maxBuffer: 1024 * 1024 },
    )
    const status = parsePorcelainStatusZ(statusOutput as Buffer)
    const safety = previewRigRegistration(status)
    const fingerprint = createHash('sha256')
      .update(repository.realPath)
      .update('\0')
      .update(defaultBranch)
      .update('\0')
      .update(await git(['rev-parse', 'HEAD']))
      .update('\0')
      .update(await git(['write-tree']))
      .update('\0')
      .update(statusOutput as Buffer)
      .digest('hex')
    return {
      repository,
      preview: {
        rootId,
        relativePath: repository.relativePath,
        suggestedName: path.basename(repository.realPath),
        detectedBranch,
        defaultBranch,
        branches,
        status: status.map((entry: RepositoryStatusEntry) => ({
          path: entry.path,
          staged: entry.staged,
          untracked: entry.untracked ?? false,
        })),
        safe: safety.safe,
        blockedReason: safety.blockedReason ?? null,
        repositoryMutations: [...GAS_CITY_REPOSITORY_MUTATIONS],
        fingerprint,
      },
    }
  }

  async #isGitRepository(directory: string): Promise<boolean> {
    try {
      const dotGit = await fs.lstat(path.join(directory, '.git'))
      return dotGit.isDirectory() || dotGit.isFile()
    } catch {
      return false
    }
  }

  #validateRemoteUrl(value: string): ValidatedRemoteUrl {
    const trimmed = value.trim()
    const scp = /^([\w.-]+)@([\w.-]+):([^\s]+)$/.exec(trimmed)
    if (scp) return { sourceUrl: trimmed, transport: 'ssh', host: scp[2]! }
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      throw new RepositoryError('repository_url_invalid', 'Use an HTTPS or SSH Git repository URL')
    }
    if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname) {
      throw new RepositoryError('repository_url_invalid', 'Use an HTTPS or SSH Git repository URL')
    }
    if (url.password || (url.protocol === 'https:' && url.username)) {
      throw new RepositoryError(
        'repository_url_contains_credentials',
        'Repository URLs must not contain credentials; configure access on the server instead',
      )
    }
    url.hash = ''
    return {
      sourceUrl: url.toString(),
      transport: url.protocol === 'ssh:' ? 'ssh' : 'https',
      host: url.hostname,
    }
  }

  #nonInteractiveGitEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      SSH_ASKPASS_REQUIRE: 'never',
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
    }
  }

  #classifyAccessFailure(error: unknown, remote: ValidatedRemoteUrl): RepositoryError {
    const failure = error as {
      code?: string | number
      killed?: boolean
      signal?: string
      stderr?: string | Buffer
      stdout?: string | Buffer
    }
    const output = `${String(failure.stderr ?? '')}\n${String(failure.stdout ?? '')}`.toLowerCase()
    if (failure.code === 'ENOENT') {
      return new RepositoryError(
        'git_unavailable',
        'Git is not installed or is unavailable to the operating-system user running Factoru Server.',
      )
    }
    if (failure.killed || failure.signal === 'SIGTERM' || failure.code === 'ETIMEDOUT') {
      return new RepositoryError(
        'repository_access_timeout',
        `Factoru Server timed out while checking ${remote.host}. Check the factory network and try again.`,
      )
    }
    if (
      output.includes('host key verification failed') ||
      output.includes('remote host identification has changed') ||
      output.includes('authenticity of host')
    ) {
      return new RepositoryError(
        'repository_host_key_required',
        `Factoru Server does not trust the SSH host key for ${remote.host}. Verify the provider fingerprint and add it to the server user's known_hosts, then retry.`,
      )
    }
    if (
      output.includes('permission denied (publickey') ||
      output.includes('authentication failed') ||
      output.includes('http basic: access denied') ||
      output.includes('invalid username or password') ||
      output.includes('invalid username or token') ||
      output.includes('error: 401') ||
      output.includes('could not read username') ||
      output.includes('terminal prompts disabled') ||
      output.includes('no such identity') ||
      output.includes('sign_and_send_pubkey')
    ) {
      return new RepositoryError(
        'repository_authentication_required',
        `Factoru Server cannot authenticate to ${remote.host}. Configure Git credentials or an SSH identity for the operating-system user running Factoru Server, then retry.`,
      )
    }
    if (
      output.includes('repository not found') ||
      output.includes('does not appear to be a git repository') ||
      output.includes('could not read from remote repository') ||
      output.includes('error: 403') ||
      output.includes('not found')
    ) {
      return new RepositoryError(
        'repository_not_found_or_forbidden',
        `Factoru Server cannot read that repository on ${remote.host}. Verify the URL and the server user's repository permission, then retry.`,
      )
    }
    if (
      output.includes('could not resolve host') ||
      output.includes('could not resolve hostname') ||
      output.includes('connection timed out') ||
      output.includes('operation timed out') ||
      output.includes('failed to connect') ||
      output.includes('connection refused') ||
      output.includes('network is unreachable') ||
      output.includes('no route to host')
    ) {
      return new RepositoryError(
        'repository_network_unavailable',
        `Factoru Server cannot reach ${remote.host}. Check DNS, firewall, and network access on the factory, then retry.`,
      )
    }
    return new RepositoryError(
      'repository_access_failed',
      `Factoru Server could not verify repository access on ${remote.host}. Run factoru-server repositories check --url <repository-url> on the factory for a focused diagnostic.`,
    )
  }

  #remoteRepositoryName(sourceUrl: string): string {
    const pathname = sourceUrl.includes('://')
      ? new URL(sourceUrl).pathname
      : sourceUrl.slice(sourceUrl.indexOf(':') + 1)
    const candidate =
      pathname
        .split('/')
        .filter(Boolean)
        .at(-1)
        ?.replace(/\.git$/, '') ?? 'repo'
    const safe = candidate
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
    return safe || 'repo'
  }
}
