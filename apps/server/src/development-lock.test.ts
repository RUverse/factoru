import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptDevelopmentServerLock } from './development-lock.js'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('development server lock handoff', () => {
  it('makes the long-lived server the lock owner and releases it', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-server-lock-'))
    directories.push(dataDir)
    const lockFile = path.join(dataDir, 'dev-server.lock')
    fs.writeFileSync(lockFile, '{"pid":101,"token":"handoff"}\n')

    const lock = adoptDevelopmentServerLock(
      dataDir,
      {
        FACTORU_DEV_SERVER_LOCK_FILE: lockFile,
        FACTORU_DEV_SERVER_LOCK_TOKEN: 'handoff',
      },
      202,
    )

    expect(JSON.parse(fs.readFileSync(lockFile, 'utf8'))).toEqual({ pid: 202, token: 'handoff' })
    lock?.release()
    expect(fs.existsSync(lockFile)).toBe(false)
  })

  it('refuses a lock outside the configured data directory', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-server-lock-'))
    directories.push(dataDir)
    expect(() =>
      adoptDevelopmentServerLock(dataDir, {
        FACTORU_DEV_SERVER_LOCK_FILE: path.join(os.tmpdir(), 'other.lock'),
        FACTORU_DEV_SERVER_LOCK_TOKEN: 'handoff',
      }),
    ).toThrow(/must be/)
  })
})
