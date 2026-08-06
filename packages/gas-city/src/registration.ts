import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parsePorcelainStatusZ, previewRigRegistration } from './rig-safety.js'
import { GasCityError } from './errors.js'

const exec = promisify(execFile)

export interface RegisterProjectRigRequest {
  cityPath: string
  repositoryPath: string
  rigName: string
  beadPrefix: string
  defaultBranch: string
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

/** Real, idempotent CLI-backed registration for the pinned Gas City release. */
export class GasCityRigRegistrar implements RigRegistrar {
  constructor(readonly executor: CommandExecutor = defaultExecutor) {}

  async register(request: RegisterProjectRigRequest): Promise<void> {
    const status = await exec('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: request.repositoryPath,
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
    })
    const preview = previewRigRegistration(parsePorcelainStatusZ(status.stdout as Buffer))
    if (!preview.safe) {
      throw new GasCityError(preview.blockedReason ?? 'Repository index is not clean', {
        kind: 'invalid_request',
        code: 'repository_index_dirty',
      })
    }

    try {
      await this.executor.run('gc', [
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
      ])
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
      await this.executor.run('gc', ['import', 'install', '--city', request.cityPath])
      await this.executor.run('gc', ['reload', '--city', request.cityPath])
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new GasCityError(`Gas City could not finish rig configuration: ${message}`, {
        kind: 'unavailable',
        cause,
      })
    }
  }
}
