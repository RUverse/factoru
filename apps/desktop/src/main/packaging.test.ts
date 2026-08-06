import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop runtime packaging', () => {
  it('ships the Node WebSocket client as an external production dependency', () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(manifest.dependencies?.ws).toMatch(/^\^8\./)
    expect(manifest.devDependencies?.ws).toBeUndefined()
  })
})
