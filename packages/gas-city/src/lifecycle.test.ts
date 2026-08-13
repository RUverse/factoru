import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GasCityRuntimeLifecycle,
  type GasCityLifecycleCommandExecutor,
  type RuntimeProcessController,
  type RuntimeProcessSnapshot,
} from './lifecycle.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

function city(): string {
  const cityPath = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-lifecycle-'))
  directories.push(cityPath)
  return cityPath
}

function recordingExecutor(
  failure?: (executable: string, args: readonly string[]) => Error | undefined,
): { executor: GasCityLifecycleCommandExecutor; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    executor: {
      async run(executable, args) {
        calls.push([executable, ...args])
        const error = failure?.(executable, args)
        if (error) throw error
        return { stdout: '', stderr: '' }
      },
    },
  }
}

describe('GasCityRuntimeLifecycle', () => {
  it('stops only the dedicated city and its deterministic tmux server', async () => {
    const cityPath = city()
    const { executor, calls } = recordingExecutor()
    await new GasCityRuntimeLifecycle({
      cityName: 'factoru-server123',
      cityPath,
      executor,
      stopTimeoutMs: 12_000,
    }).stop()

    expect(calls).toEqual([
      ['gc', 'stop', '--city', cityPath, '--timeout', '12000ms', '--json'],
      ['tmux', '-L', 'factoru-server123', 'kill-server'],
    ])
  })

  it('treats an absent tmux server and a stale Dolt PID as already stopped', async () => {
    const cityPath = city()
    const runtime = path.join(cityPath, '.gc/runtime/packs/dolt')
    fs.mkdirSync(runtime, { recursive: true })
    fs.writeFileSync(path.join(runtime, 'dolt.pid'), '4567\n')
    const { executor } = recordingExecutor((executable) =>
      executable === 'tmux'
        ? Object.assign(new Error('no server running'), { stderr: 'no server' })
        : undefined,
    )
    const processes: RuntimeProcessController = {
      inspect: async () => null,
      signal: () => undefined,
      waitForExit: async () => true,
    }

    await expect(
      new GasCityRuntimeLifecycle({
        cityName: 'factoru-server123',
        cityPath,
        executor,
        processes,
      }).stop(),
    ).resolves.toBeUndefined()
  })

  it('terminates a validated leaked watchdog before its Dolt child', async () => {
    const cityPath = city()
    const runtime = path.join(cityPath, '.gc/runtime/packs/dolt')
    const configPath = path.join(runtime, 'dolt-config.yaml')
    fs.mkdirSync(runtime, { recursive: true })
    fs.writeFileSync(path.join(runtime, 'dolt.pid'), '42\n')
    const snapshots = new Map<number, RuntimeProcessSnapshot>([
      [42, { pid: 42, parentPid: 41, command: `dolt sql-server --config ${configPath}` }],
      [
        41,
        {
          pid: 41,
          parentPid: 1,
          command: `gc __gc-managed-dolt-scope-watchdog ${configPath} ${cityPath}`,
        },
      ],
    ])
    const signals: [number, NodeJS.Signals][] = []
    const processes: RuntimeProcessController = {
      inspect: async (pid) => snapshots.get(pid) ?? null,
      signal(pid, signal) {
        signals.push([pid, signal])
        snapshots.delete(pid)
      },
      waitForExit: async (pid) => !snapshots.has(pid),
    }
    const { executor } = recordingExecutor((executable) =>
      executable === 'gc' ? new Error('gc stop timed out') : undefined,
    )

    await new GasCityRuntimeLifecycle({
      cityName: 'factoru-server123',
      cityPath,
      executor,
      processes,
    }).stop()

    expect(signals).toEqual([
      [41, 'SIGTERM'],
      [42, 'SIGTERM'],
    ])
  })

  it('refuses to signal a PID that does not match the city Dolt config', async () => {
    const cityPath = city()
    const runtime = path.join(cityPath, '.gc/runtime/packs/dolt')
    fs.mkdirSync(runtime, { recursive: true })
    fs.writeFileSync(path.join(runtime, 'dolt.pid'), '42\n')
    const processes: RuntimeProcessController = {
      inspect: async () => ({
        pid: 42,
        parentPid: 1,
        command: 'dolt sql-server --config /another-city/dolt-config.yaml',
      }),
      signal: () => {
        throw new Error('must not signal')
      },
      waitForExit: async () => false,
    }
    const { executor } = recordingExecutor()

    await expect(
      new GasCityRuntimeLifecycle({
        cityName: 'factoru-server123',
        cityPath,
        executor,
        processes,
      }).stop(),
    ).rejects.toThrow(/not owned by Factoru/)
  })
})
