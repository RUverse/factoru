import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { parse } from 'smol-toml'
import { parsePorcelainStatusZ, previewRigRegistration } from './rig-safety.js'
import { GasCityError } from './errors.js'

const exec = promisify(execFile)

export interface RegisterProjectRigRequest {
  cityPath: string
  repositoryPath: string
  rigName: string
  beadPrefix: string
  defaultBranch: string
  /** Permit recovery only for Factoru-owned managed clones after a prior partial attempt. */
  recoverPartialManagedSetup?: boolean
}

export interface RigRegistrar {
  register(request: RegisterProjectRigRequest): Promise<void>
}

export interface CommandExecutor {
  run(
    executable: string,
    args: readonly string[],
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string }>
}

const defaultExecutor: CommandExecutor = {
  async run(executable, args, cwd) {
    const result = await exec(executable, [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
    return { stdout: result.stdout, stderr: result.stderr }
  },
}

interface PinnedFactoruImport {
  source: string
  version?: string
}

const PROVIDER_CONFIGURATION_REMEDY =
  'On the Factoru Server, run pnpm dev:city --provider codex for development or factoru-server providers configure --provider codex for a source-preview installation (replace codex with claude if needed), then retry repository setup.'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readPinnedFactoruImport(cityPath: string): PinnedFactoruImport {
  const packFile = path.join(cityPath, 'pack.toml')
  const cityFile = path.join(cityPath, 'city.toml')
  const packExists = fs.existsSync(packFile)
  const cityExists = fs.existsSync(cityFile)
  if (!packExists && !cityExists) {
    throw new GasCityError(
      `Gas City is not initialized for this factory. ${PROVIDER_CONFIGURATION_REMEDY}`,
      { kind: 'invalid_request', code: 'gas_city_not_initialized' },
    )
  }
  if (packExists !== cityExists) {
    throw new GasCityError(
      `Gas City is partially initialized at ${cityPath}. ${PROVIDER_CONFIGURATION_REMEDY}`,
      { kind: 'invalid_request', code: 'gas_city_partial_initialization' },
    )
  }
  let manifest: Record<string, unknown>
  try {
    manifest = record(parse(fs.readFileSync(packFile, 'utf8'))) ?? {}
  } catch (cause) {
    throw new GasCityError(
      `Gas City configuration at ${packFile} is unreadable or invalid. ${PROVIDER_CONFIGURATION_REMEDY}`,
      { kind: 'invalid_request', code: 'gas_city_pack_invalid', cause },
    )
  }
  const imported = record(record(manifest.imports)?.factoru)
  const source = imported?.source
  const version = imported?.version
  if (
    typeof source !== 'string' ||
    source.trim() === '' ||
    /[\r\n\0]/.test(source) ||
    (version !== undefined &&
      (typeof version !== 'string' || version.trim() === '' || /[\r\n\0]/.test(version)))
  ) {
    throw new GasCityError(
      `Gas City root pack must declare a valid [imports.factoru] source${version === undefined ? '' : ' and version'}. ${PROVIDER_CONFIGURATION_REMEDY}`,
      { kind: 'invalid_request', code: 'gas_city_pack_invalid' },
    )
  }
  return { source, ...(typeof version === 'string' ? { version } : {}) }
}

/** Real, idempotent CLI-backed registration for the pinned Gas City release. */
export class GasCityRigRegistrar implements RigRegistrar {
  constructor(readonly executor: CommandExecutor = defaultExecutor) {}

  async register(request: RegisterProjectRigRequest): Promise<void> {
    const factoruImport = readPinnedFactoruImport(request.cityPath)
    let preview = await this.#preview(request.repositoryPath)
    if (
      !preview.safe &&
      request.recoverPartialManagedSetup &&
      preview.stagedPaths.every(
        (candidate) => candidate === '.gitignore' || candidate.startsWith('.beads/'),
      )
    ) {
      await exec('git', ['reset', '--quiet', 'HEAD', '--', ...preview.stagedPaths], {
        cwd: request.repositoryPath,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      })
      preview = await this.#preview(request.repositoryPath)
    }
    if (!preview.safe) {
      throw new GasCityError(preview.blockedReason ?? 'Repository index is not clean', {
        kind: 'invalid_request',
        code: 'repository_index_dirty',
      })
    }

    const rigArgs = [
      'rig',
      'add',
      request.repositoryPath,
      '--name',
      request.rigName,
      '--prefix',
      request.beadPrefix,
      '--default-branch',
      request.defaultBranch,
      '--city',
      request.cityPath,
    ]
    try {
      await this.executor.run('gc', rigArgs)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      // Reconciliation is intentionally adoptive: an earlier attempt may have
      // completed `rig add` before Factoru observed its response.
      if (!/already|exists|registered/i.test(message)) {
        throw new GasCityError(`Gas City could not register the project rig: ${message}`, {
          kind: 'unavailable',
          cause,
        })
      }
    }

    try {
      const args = [
        'import',
        'add',
        factoruImport.source,
        ...(factoruImport.version ? ['--version', factoruImport.version] : []),
        '--name',
        'factoru',
        '--rig',
        request.rigName,
        '--city',
        request.cityPath,
      ]
      await this.executor.run('gc', args)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!/already|exists|registered/i.test(message)) {
        throw new GasCityError(
          `Gas City could not attach the Factoru pack to the project rig: ${message}`,
          { kind: 'unavailable', cause },
        )
      }
    }

    const commands = [
      ['import', 'install', '--city', request.cityPath],
      ['import', 'check', '--city', request.cityPath],
      ['config', 'show', '--validate', '--city', request.cityPath],
      ['reload', '--city', request.cityPath],
    ] as const
    for (const args of commands) {
      try {
        await this.executor.run('gc', args)
      } catch (cause) {
        const message = (cause instanceof Error ? cause.message : String(cause)).slice(0, 2_000)
        throw new GasCityError(`Gas City command failed (gc ${args.join(' ')}): ${message}`, {
          kind: 'unavailable',
          cause,
        })
      }
    }
  }

  async #preview(repositoryPath: string) {
    const status = await exec('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: repositoryPath,
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
    })
    return previewRigRegistration(parsePorcelainStatusZ(status.stdout as Buffer))
  }
}
