import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import net from 'node:net'
import path from 'node:path'
import {
  DEV_STATE_DIRNAME,
  PORT_RANGE_END,
  PORT_RANGE_START,
  PORTS_PER_WORKTREE,
  devEnvFor,
  findFreePortBlock,
  portBaseFor,
  portsFor,
  worktreeIdFor,
} from './worktree-env.mjs'

const listeners = []

function occupy(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      listeners.push(server)
      resolve(server)
    })
  })
}

after(async () => {
  await Promise.all(
    listeners.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  )
})

describe('worktree development environment', () => {
  it('is deterministic for the same worktree', () => {
    assert.deepEqual(devEnvFor('/Users/dev/factoru'), devEnvFor('/Users/dev/factoru'))
  })

  it('gives sibling worktrees distinct ids, ports, and data directories', () => {
    const roots = Array.from({ length: 16 }, (_, i) => `/Users/dev/worktrees/factoru-${i}`)
    const envs = roots.map((root) => devEnvFor(root))

    assert.equal(new Set(envs.map((env) => env.worktreeId)).size, roots.length)
    assert.equal(new Set(envs.map((env) => env.dataDir)).size, roots.length)
    assert.equal(new Set(envs.map((env) => env.portBase)).size, roots.length)
  })

  it('keeps development state inside the worktree', () => {
    const env = devEnvFor('/Users/dev/factoru')
    assert.equal(env.dataDir, path.join('/Users/dev/factoru', DEV_STATE_DIRNAME, env.worktreeId))
    assert.equal(env.env.FACTORU_DATA_DIR, env.dataDir)
  })

  it('allocates four consecutive ports inside the reserved range', () => {
    const base = portBaseFor(worktreeIdFor('/Users/dev/factoru'))
    const ports = Object.values(portsFor(base))

    assert.equal(new Set(ports).size, PORTS_PER_WORKTREE)
    assert.deepEqual(ports, [base, base + 1, base + 2, base + 3])
    for (const port of ports) {
      assert.ok(
        port >= PORT_RANGE_START && port < PORT_RANGE_END,
        `${port} is outside the dev range`,
      )
    }
  })

  it('points the desktop at the same server the harness starts', () => {
    const env = devEnvFor('/Users/dev/factoru')
    assert.equal(env.env.FACTORU_SERVER_URL, `http://127.0.0.1:${env.serverPort}`)
    assert.equal(env.env.FACTORU_PORT, String(env.serverPort))
  })

  it('requires an absolute worktree path', () => {
    assert.throws(() => worktreeIdFor('relative/path'), /absolute path/)
  })
})

describe('development port allocation', () => {
  it('keeps the derived block when it is free', async () => {
    const preferred = portBaseFor(worktreeIdFor('/Users/dev/factoru-free-block'))
    assert.equal(await findFreePortBlock(preferred), preferred)
  })

  it('steps forward deterministically when the derived block is taken', async () => {
    const preferred = portBaseFor(worktreeIdFor('/Users/dev/factoru-busy-block'))
    await occupy(preferred + 2)

    const resolved = await findFreePortBlock(preferred)
    assert.equal(resolved, preferred + PORTS_PER_WORKTREE)
  })

  it('reports failure instead of returning a busy block', async () => {
    const preferred = portBaseFor(worktreeIdFor('/Users/dev/factoru-exhausted'))
    await occupy(preferred)

    await assert.rejects(
      () => findFreePortBlock(preferred, { maxAttempts: 1 }),
      /free development port block/,
    )
  })
})

describe('overridden port base', () => {
  it('keeps the printed environment consistent with the resolved block', () => {
    const env = devEnvFor('/Users/dev/factoru', { portBase: 21_000 })
    assert.equal(env.serverPort, 21_000)
    assert.equal(env.rendererPort, 21_001)
    assert.equal(env.env.FACTORU_SERVER_URL, 'http://127.0.0.1:21000')
  })
})
