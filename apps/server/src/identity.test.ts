import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isServerId } from '@factoru/domain'
import { SERVER_ID_FILENAME, ServerIdentityError, ensureServerId } from './identity.js'

const created: string[] = []

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'factoru-identity-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('server identity', () => {
  it('creates an identity on first start', async () => {
    const dataDir = await tempDataDir()
    const serverId = await ensureServerId(dataDir)

    expect(isServerId(serverId)).toBe(true)
    const file = await readFile(path.join(dataDir, SERVER_ID_FILENAME), 'utf8')
    expect(file.trim()).toBe(serverId)
  })

  it('creates the data directory when it does not exist', async () => {
    const dataDir = path.join(await tempDataDir(), 'nested', 'state')
    await expect(ensureServerId(dataDir)).resolves.toSatisfy(isServerId)
  })

  it('keeps the same identity across restarts', async () => {
    const dataDir = await tempDataDir()
    expect(await ensureServerId(dataDir)).toBe(await ensureServerId(dataDir))
  })

  it('gives concurrent starts one identity', async () => {
    const dataDir = await tempDataDir()
    const ids = await Promise.all(Array.from({ length: 8 }, () => ensureServerId(dataDir)))
    expect(new Set(ids).size).toBe(1)
  })

  it('refuses to silently replace a corrupt identity', async () => {
    const dataDir = await tempDataDir()
    await writeFile(path.join(dataDir, SERVER_ID_FILENAME), 'not-a-server-id\n')

    await expect(ensureServerId(dataDir)).rejects.toThrow(ServerIdentityError)
  })

  it('gives separate data directories separate identities', async () => {
    const first = await ensureServerId(await tempDataDir())
    const second = await ensureServerId(await tempDataDir())
    expect(first).not.toBe(second)
  })
})
