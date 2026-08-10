import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('toolchain manifest', () => {
  it('keeps pnpm, Volta, engines, and the downloaded Node runtime aligned', () => {
    assert.equal(manifest.packageManager, 'pnpm@11.20.0')
    assert.equal(manifest.engines.node, '>=22.13.0 <23')
    assert.deepEqual(manifest.devEngines.runtime, {
      name: 'node',
      version: '22.13.0',
      onFail: 'download',
    })
    assert.deepEqual(manifest.volta, {
      node: manifest.devEngines.runtime.version,
      pnpm: manifest.packageManager.slice('pnpm@'.length),
    })
  })
})
