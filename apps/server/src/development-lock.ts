import fs from 'node:fs'
import path from 'node:path'

export interface DevelopmentServerLock {
  release(): void
}

/** Transfer the development launcher lock to the actual long-lived server process. */
export function adoptDevelopmentServerLock(
  dataDir: string,
  environment: NodeJS.ProcessEnv = process.env,
  pid = process.pid,
): DevelopmentServerLock | undefined {
  const lockFile = environment.FACTORU_DEV_SERVER_LOCK_FILE
  const token = environment.FACTORU_DEV_SERVER_LOCK_TOKEN
  if (!lockFile && !token) return undefined
  if (!lockFile || !token) throw new Error('Factoru development server lock environment is partial')
  const expectedFile = path.join(path.resolve(dataDir), 'dev-server.lock')
  if (path.resolve(lockFile) !== expectedFile) {
    throw new Error(`Factoru development server lock must be ${expectedFile}`)
  }
  const current = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as {
    pid?: unknown
    token?: unknown
  }
  if (current.token !== token) {
    throw new Error('Factoru development server lock ownership changed before server startup')
  }
  fs.writeFileSync(lockFile, `${JSON.stringify({ pid, token })}\n`, { mode: 0o600 })
  let released = false
  return {
    release() {
      if (released) return
      released = true
      try {
        const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as {
          pid?: unknown
          token?: unknown
        }
        if (owner.pid === pid && owner.token === token) fs.unlinkSync(lockFile)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
    },
  }
}
