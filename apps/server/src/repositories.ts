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

export interface RepositoryEntry {
  name: string
  relativePath: string
  kind: 'directory' | 'repository'
}

export class RepositoryService {
  readonly #roots: ReadonlyMap<string, RepositoryRootConfig>

  constructor(roots: readonly RepositoryRootConfig[]) {
    this.#roots = new Map(
      roots.map((root) => {
        const normalized = { ...root, path: fsSync.realpathSync(root.path) }
        return [normalized.id, normalized]
      }),
    )
  }

  roots(): Array<{ id: string; label: string }> {
    return [...this.#roots.values()].map(({ id, label }) => ({ id, label }))
  }

  rootLabel(rootId: string): string {
    return this.#roots.get(rootId)?.label ?? 'Repository'
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
}
