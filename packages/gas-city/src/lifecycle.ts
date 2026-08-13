import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GasCityLifecycleCommandExecutor {
  run(executable: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }>
}

export interface RuntimeProcessSnapshot {
  readonly pid: number
  readonly parentPid: number
  readonly command: string
}

export interface RuntimeProcessController {
  inspect(pid: number): Promise<RuntimeProcessSnapshot | null>
  signal(pid: number, signal: NodeJS.Signals): void
  waitForExit(pid: number, timeoutMs: number): Promise<boolean>
}

export interface GasCityRuntimeLifecycleOptions {
  readonly cityName: string
  readonly cityPath: string
  readonly executor?: GasCityLifecycleCommandExecutor
  readonly processes?: RuntimeProcessController
  readonly stopTimeoutMs?: number
}

const defaultExecutor: GasCityLifecycleCommandExecutor = {
  async run(executable, args) {
    const result = await execFileAsync(executable, [...args], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 35_000,
    })
    return { stdout: result.stdout, stderr: result.stderr }
  },
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const defaultProcesses: RuntimeProcessController = {
  async inspect(pid) {
    try {
      const result = await execFileAsync(
        'ps',
        ['-p', String(pid), '-o', 'ppid=', '-o', 'command='],
        {
          encoding: 'utf8',
          timeout: 2_000,
        },
      )
      const match = result.stdout.trim().match(/^(\d+)\s+([\s\S]+)$/)
      return match ? { pid, parentPid: Number(match[1]), command: match[2]!.trim() } : null
    } catch {
      return null
    }
  },
  signal(pid, signal) {
    process.kill(pid, signal)
  },
  async waitForExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
        throw error
      }
      await delay(100)
    }
    return false
  },
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const record = error as Record<string, unknown>
  return ['message', 'stdout', 'stderr']
    .map((field) => (record[field] === undefined ? '' : String(record[field])))
    .filter(Boolean)
    .join('\n')
}

function isMissingTmuxServer(error: unknown): boolean {
  return /no server running|failed to connect to server|no sessions/i.test(errorText(error))
}

/**
 * Owns shutdown of the one dedicated Gas City runtime attached to Factoru Server.
 *
 * Gas City's supported `gc stop` remains the primary lifecycle operation. The
 * exact tmux socket and Dolt PID-file fallbacks exist because pinned 1.4.0 can
 * report a stopped city while an orphaned named session or Dolt watchdog still
 * survives. Every fallback revalidates process identity before signalling it.
 */
export class GasCityRuntimeLifecycle {
  readonly #cityName: string
  readonly #cityPath: string
  readonly #executor: GasCityLifecycleCommandExecutor
  readonly #processes: RuntimeProcessController
  readonly #stopTimeoutMs: number

  constructor(options: GasCityRuntimeLifecycleOptions) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.cityName)) {
      throw new Error(`Unsafe Gas City lifecycle name: ${options.cityName}`)
    }
    if (!path.isAbsolute(options.cityPath)) {
      throw new Error(`Gas City lifecycle path must be absolute: ${options.cityPath}`)
    }
    this.#cityName = options.cityName
    this.#cityPath = path.resolve(options.cityPath)
    this.#executor = options.executor ?? defaultExecutor
    this.#processes = options.processes ?? defaultProcesses
    this.#stopTimeoutMs = options.stopTimeoutMs ?? 30_000
  }

  async stop(): Promise<void> {
    if (!fs.existsSync(this.#cityPath)) return

    // This command gracefully interrupts sessions before it escalates and also
    // asks Gas City to stop its city-scoped Dolt server.
    await this.#executor
      .run('gc', [
        'stop',
        '--city',
        this.#cityPath,
        '--timeout',
        `${this.#stopTimeoutMs}ms`,
        '--json',
      ])
      .catch(() => undefined)

    // A leaked named session can restart Dolt after `gc stop` returns. The
    // socket name is deterministic and unique to this Factoru Server's city.
    try {
      await this.#executor.run('tmux', ['-L', this.#cityName, 'kill-server'])
    } catch (error) {
      if (!isMissingTmuxServer(error)) {
        throw new Error(`Could not stop Factoru's Gas City tmux server: ${errorText(error)}`, {
          cause: error,
        })
      }
    }

    await this.#stopLeakedDolt()
  }

  async #stopLeakedDolt(): Promise<void> {
    const runtimeDirectory = path.join(this.#cityPath, '.gc', 'runtime', 'packs', 'dolt')
    const pidFile = path.join(runtimeDirectory, 'dolt.pid')
    let source: string
    try {
      source = fs.readFileSync(pidFile, 'utf8').trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (!/^[1-9]\d*$/.test(source)) {
      throw new Error(`Refusing unsafe Dolt cleanup: invalid PID file ${pidFile}`)
    }

    const doltPid = Number(source)
    const dolt = await this.#processes.inspect(doltPid)
    if (!dolt) return
    const configPath = path.join(runtimeDirectory, 'dolt-config.yaml')
    const isOwnedDolt = (process: RuntimeProcessSnapshot) =>
      /(?:^|\/)dolt\s+sql-server(?:\s|$)/.test(process.command) &&
      process.command.includes(configPath)
    if (!isOwnedDolt(dolt)) {
      throw new Error(`Refusing unsafe Dolt cleanup: PID ${doltPid} is not owned by Factoru`)
    }

    if (dolt.parentPid > 1) {
      const parent = await this.#processes.inspect(dolt.parentPid)
      if (parent?.command.includes('__gc-managed-dolt-scope-watchdog')) {
        const isOwnedWatchdog = (process: RuntimeProcessSnapshot) =>
          process.command.includes('__gc-managed-dolt-scope-watchdog') &&
          process.command.includes(configPath) &&
          process.command.includes(this.#cityPath)
        await this.#stopValidatedProcess(parent, isOwnedWatchdog, 'Dolt watchdog')
      }
    }

    const remainingDolt = await this.#processes.inspect(doltPid)
    if (remainingDolt) {
      await this.#stopValidatedProcess(remainingDolt, isOwnedDolt, 'Dolt server')
    }
  }

  async #stopValidatedProcess(
    snapshot: RuntimeProcessSnapshot,
    isOwned: (process: RuntimeProcessSnapshot) => boolean,
    label: string,
  ): Promise<void> {
    if (!isOwned(snapshot)) {
      throw new Error(`Refusing unsafe ${label} cleanup: PID ${snapshot.pid} changed identity`)
    }
    this.#processes.signal(snapshot.pid, 'SIGTERM')
    if (await this.#processes.waitForExit(snapshot.pid, 2_000)) return

    const remaining = await this.#processes.inspect(snapshot.pid)
    if (!remaining) return
    if (!isOwned(remaining)) {
      throw new Error(`Refusing unsafe ${label} cleanup: PID ${snapshot.pid} changed identity`)
    }
    this.#processes.signal(snapshot.pid, 'SIGKILL')
    if (!(await this.#processes.waitForExit(snapshot.pid, 2_000))) {
      throw new Error(`${label} PID ${snapshot.pid} did not stop`)
    }
  }
}
