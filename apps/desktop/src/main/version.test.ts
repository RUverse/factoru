import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESKTOP_VERSION } from './version'

describe('desktop version', () => {
  it('matches package.json', async () => {
    const manifestPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'package.json',
    )
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string }

    expect(DESKTOP_VERSION).toBe(manifest.version)
  })
})
