import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverFactoruServerUrl } from '../packs/factoru-default/assets/probe-tool/server-url.mjs'
import { resolveWorktreeRoot } from './worktree-env.mjs'

describe('portable Factoru agent contracts', () => {
  it('leave concrete provider and model choices to Worker Type deployment bindings', () => {
    const agents = path.join(resolveWorktreeRoot(), 'packs', 'factoru-default', 'agents')
    for (const entry of fs.readdirSync(agents, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const source = fs.readFileSync(path.join(agents, entry.name, 'agent.toml'), 'utf8')
      assert.doesNotMatch(source, /^provider\s*=/m, `${entry.name} hard-codes a provider`)
      assert.doesNotMatch(source, /^model\s*=/m, `${entry.name} hard-codes a model`)
    }
  })
})

describe('Factoru agent-tool server discovery', () => {
  it('reads the private server projection from the Gas City runtime', (context) => {
    const city = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-tool-city-'))
    context.after(() => fs.rmSync(city, { recursive: true }))
    fs.mkdirSync(path.join(city, '.gc'))
    fs.writeFileSync(
      path.join(city, '.gc/factoru-server.json'),
      '{"version":1,"serverUrl":"http://127.0.0.1:32100"}\n',
      { mode: 0o600 },
    )
    assert.equal(
      discoverFactoruServerUrl({ env: { GC_CITY: city }, workdir: city }),
      'http://127.0.0.1:32100',
    )
  })

  it('rejects exposed, linked, or non-loopback server projections', (context) => {
    const city = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-tool-city-'))
    context.after(() => fs.rmSync(city, { recursive: true }))
    fs.mkdirSync(path.join(city, '.gc'))
    const projection = path.join(city, '.gc/factoru-server.json')
    fs.writeFileSync(projection, '{"version":1,"serverUrl":"http://127.0.0.1:32100"}\n', {
      mode: 0o644,
    })
    assert.throws(
      () => discoverFactoruServerUrl({ env: { GC_CITY: city }, workdir: city }),
      /private regular file/,
    )

    fs.chmodSync(projection, 0o600)
    fs.writeFileSync(projection, '{"version":1,"serverUrl":"https://factoru.example.com"}\n')
    assert.throws(
      () => discoverFactoruServerUrl({ env: { GC_CITY: city }, workdir: city }),
      /bare HTTP loopback/,
    )

    fs.unlinkSync(projection)
    fs.symlinkSync(path.join(city, 'missing'), projection)
    assert.throws(
      () => discoverFactoruServerUrl({ env: { GC_CITY: city }, workdir: city }),
      /private regular file/,
    )
  })

  it('validates an explicit endpoint and retains the stable production fallback', () => {
    assert.equal(
      discoverFactoruServerUrl({ env: { FACTORU_SERVER_URL: 'http://localhost:8788/' } }),
      'http://localhost:8788',
    )
    assert.throws(
      () =>
        discoverFactoruServerUrl({
          env: { FACTORU_SERVER_URL: 'http://127.0.0.1:8788/path' },
        }),
      /bare HTTP loopback/,
    )
    assert.equal(
      discoverFactoruServerUrl({ env: {}, workdir: '/definitely/not/a/factoru/worktree' }),
      'http://127.0.0.1:8787',
    )
  })
})
