import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServerId, parseServerId, type ServerId } from '@factoru/domain'

export const SERVER_ID_FILENAME = 'server-id'

export class ServerIdentityError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ServerIdentityError'
  }
}

/**
 * Reads this server's stable identity from its data directory, creating it on
 * first start.
 *
 * The identity is never silently regenerated: desktop connection profiles bind
 * cached data — and, from Milestone 2, credentials — to it, so a corrupt file is
 * an error the operator must resolve rather than a reason to become a different
 * server.
 */
export async function ensureServerId(dataDir: string): Promise<ServerId> {
  const file = path.join(dataDir, SERVER_ID_FILENAME)

  await mkdir(dataDir, { recursive: true })

  try {
    // `wx` fails when the file exists, so concurrent starts cannot both win.
    const created = createServerId()
    await writeFile(file, `${created}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return created
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new ServerIdentityError(`Could not write the server identity file at ${file}`, {
        cause,
      })
    }
  }

  const raw = await readFile(file, 'utf8')
  try {
    return parseServerId(raw.trim())
  } catch (cause) {
    throw new ServerIdentityError(
      `The server identity file at ${file} is not a valid Factoru server id. ` +
        'Restore it from backup or remove it to provision a new server identity.',
      { cause },
    )
  }
}
