import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVER_VERSION } from './version.js'

describe('server version', () => {
  it('matches package.json', async () => {
    const packageJsonPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'package.json',
    )
    const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string }

    expect(SERVER_VERSION).toBe(manifest.version)
  })
})
