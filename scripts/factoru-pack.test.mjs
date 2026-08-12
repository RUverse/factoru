import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverFactoruServerUrl } from '../packs/factoru-default/assets/probe-tool/server-url.mjs'
import { publishCurrentReply } from '../packs/factoru-default/assets/reply-current.mjs'
import { resolveWorktreeRoot } from './worktree-env.mjs'

describe('portable Factoru agent contracts', () => {
  it('leave concrete provider and model choices to Team deployment bindings', () => {
    const agents = path.join(resolveWorktreeRoot(), 'packs', 'factoru-default', 'agents')
    for (const entry of fs.readdirSync(agents, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const source = fs.readFileSync(path.join(agents, entry.name, 'agent.toml'), 'utf8')
      assert.doesNotMatch(source, /^provider\s*=/m, `${entry.name} hard-codes a provider`)
      assert.doesNotMatch(source, /^model\s*=/m, `${entry.name} hard-codes a model`)
    }
  })

  it('pins the upstream build pack and keeps Standard Build a bounded overlay', () => {
    const root = resolveWorktreeRoot()
    const pack = fs.readFileSync(path.join(root, 'packs/factoru-default/pack.toml'), 'utf8')
    const lock = fs.readFileSync(path.join(root, 'packs/factoru-default/packs.lock'), 'utf8')
    const formula = fs.readFileSync(
      path.join(root, 'packs/factoru-default/formulas/standard-build.formula.toml'),
      'utf8',
    )
    assert.match(pack, /version = "0\.4\.2"/)
    assert.match(pack, /gascity\/roles/)
    assert.match(pack, /tree\/main\/gascity"/)
    assert.equal(lock.match(/3b3b89f2011e06d84459aa7bea1552382f13930a/g)?.length, 4)
    assert.match(formula, /extends = \["build-basic"\]/)
    assert.equal(formula.match(/max_units = 20/g)?.length, 2)
    assert.match(formula, /id = "factoru-verify"[\s\S]*max_attempts = 2/)
    assert.match(formula, /id = "review"[\s\S]*needs = \["factoru-verify"\]/)
    assert.doesNotMatch(formula, /mayor/i)
  })

  it('declares a supported type for every Formula variable', () => {
    const formulas = path.join(resolveWorktreeRoot(), 'packs', 'factoru-default', 'formulas')
    for (const entry of fs.readdirSync(formulas, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.formula.toml')) continue
      const source = fs.readFileSync(path.join(formulas, entry.name), 'utf8')
      for (const match of source.matchAll(/^\[vars\.([^\]]+)\]\n([\s\S]*?)(?=^\[)/gm)) {
        assert.match(
          match[2],
          /^type = "(?:string|int|bool)"$/m,
          `${entry.name} vars.${match[1]} lacks a supported type`,
        )
      }
    }
  })

  it('keeps each Blueprint default inside its allowed Formula Preset catalog', () => {
    const root = resolveWorktreeRoot()
    const blueprints = []
    for (const relative of [
      'templates/software-project/template.json',
      'templates/fast-patch/template.json',
    ]) {
      const blueprint = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
      blueprints.push(blueprint)
      assert.equal(blueprint.version, 1)
      assert.equal(blueprint.pack.id, 'factoru-default')
      assert.equal(blueprint.pack.lock, '../../packs/factoru-default/packs.lock')
      assert.ok(blueprint.allowedWorkflowPresetIds.includes(blueprint.defaultWorkflowPresetId))
      assert.deepEqual(blueprint.team.software_engineer.modelSlots, [
        'design',
        'implementation',
        'review',
      ])
      assert.equal(blueprint.factory.maxParallelImplementationWorkers, 1)
      assert.deepEqual(Object.keys(blueprint.workflowPresets).sort(), [
        'fast-patch',
        'standard-build',
      ])
      assert.deepEqual(blueprint.workflowPresets['standard-build'], {
        formula: 'standard-build',
        formulaVersion: '1',
        launchMode: 'attached',
        variables: {
          interaction_mode: 'autonomous',
          review_mode: 'agent',
          drain_policy: 'same-session',
          max_iterations: 6,
          push: false,
          open_pr: false,
        },
        maxImplementationUnits: 20,
        maxVerificationAttempts: 2,
        maxCorrectionAttempts: 6,
      })
      assert.equal(blueprint.workflowPresets['fast-patch'].launchMode, 'standalone')
      assert.equal(blueprint.workflowPresets['fast-patch'].maxCorrectionAttempts, 2)
    }
    assert.equal(blueprints.filter((blueprint) => blueprint.recommended).length, 1)
    assert.equal(
      blueprints.find((blueprint) => blueprint.recommended).id,
      'standard-software-project',
    )
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
    fs.writeFileSync(
      path.join(city, '.gc/factoru-server.json'),
      JSON.stringify({
        version: 2,
        serverUrl: 'http://127.0.0.1:32101',
        gasCitySupervisorUrl: 'http://127.0.0.1:8372',
        cityName: 'factoru-test',
      }),
      { mode: 0o600 },
    )
    assert.equal(
      discoverFactoruServerUrl({ env: { GC_CITY: city }, workdir: city }),
      'http://127.0.0.1:32101',
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

describe('Factoru conversation reply command', () => {
  it('replies to the latest inbound turn through Gas City with a stable key', async (context) => {
    const city = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-reply-city-'))
    context.after(() => fs.rmSync(city, { recursive: true }))
    fs.mkdirSync(path.join(city, '.gc'))
    fs.writeFileSync(
      path.join(city, '.gc/factoru-server.json'),
      JSON.stringify({
        version: 2,
        serverUrl: 'http://127.0.0.1:32100',
        gasCitySupervisorUrl: 'http://127.0.0.1:38372',
        cityName: 'factoru-test',
      }),
      { mode: 0o600 },
    )
    const calls = []
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: new URL(url), init })
      if ((init.method ?? 'GET') === 'GET') {
        return new Response(
          JSON.stringify({
            items: [
              {
                Sequence: 1,
                Kind: 'inbound',
                ProviderMessageID: 'msg-user-1',
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          Receipt: {
            MessageID: 'factoru-out-1',
            Delivered: true,
            FailureKind: '',
          },
          TranscriptEntry: { Sequence: 2 },
        }),
        { status: 200 },
      )
    }

    const result = await publishCurrentReply({
      argv: ['--conversation-id', 'conv-1', '--body', 'Inspect the entrypoint.'],
      env: {
        GC_CITY_PATH: city,
        GC_SESSION_ID: 'fc-chat-1',
        FACTORU_CONVERSATION_SCOPE_ID: 'factoru-rig',
        FACTORU_CONVERSATION_ACCOUNT_ID: 'factoru-server',
        FACTORU_CONVERSATION_ID: 'conv-1',
      },
      fetchImpl,
    })

    assert.deepEqual(result, {
      delivered: true,
      messageId: 'factoru-out-1',
      sequence: 2,
      replyTo: 'msg-user-1',
    })
    assert.equal(calls.length, 2)
    const outbound = JSON.parse(calls[1].init.body)
    assert.deepEqual(outbound.conversation, {
      scope_id: 'factoru-rig',
      provider: 'factoru',
      account_id: 'factoru-server',
      conversation_id: 'conv-1',
      kind: 'dm',
    })
    assert.equal(outbound.reply_to_message_id, 'msg-user-1')
    assert.match(outbound.idempotency_key, /^[a-f0-9]{64}$/)
    assert.equal(calls[1].init.headers['X-GC-Request'], 'factoru-reply')
  })

  it('rejects a conversation hint outside the current session scope', async (context) => {
    const city = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-reply-city-'))
    context.after(() => fs.rmSync(city, { recursive: true }))
    fs.mkdirSync(path.join(city, '.gc'))
    fs.writeFileSync(
      path.join(city, '.gc/factoru-server.json'),
      JSON.stringify({
        version: 2,
        gasCitySupervisorUrl: 'http://127.0.0.1:38372',
        cityName: 'factoru-test',
      }),
      { mode: 0o600 },
    )
    await assert.rejects(
      publishCurrentReply({
        argv: ['--conversation-id', 'conv-other', '--body', 'Do not send this.'],
        env: {
          GC_CITY_PATH: city,
          GC_SESSION_ID: 'fc-chat-1',
          FACTORU_CONVERSATION_SCOPE_ID: 'factoru-rig',
          FACTORU_CONVERSATION_ACCOUNT_ID: 'factoru-server',
          FACTORU_CONVERSATION_ID: 'conv-1',
        },
      }),
      /does not match the current Factoru session/,
    )
  })

  it('rejects a supervisor origin outside the host-local trust boundary', async (context) => {
    const city = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-reply-city-'))
    context.after(() => fs.rmSync(city, { recursive: true }))
    fs.mkdirSync(path.join(city, '.gc'))
    fs.writeFileSync(
      path.join(city, '.gc/factoru-server.json'),
      JSON.stringify({
        version: 2,
        gasCitySupervisorUrl: 'https://gas-city.example.com',
        cityName: 'factoru-test',
      }),
      { mode: 0o600 },
    )
    await assert.rejects(
      publishCurrentReply({
        argv: ['--body', 'Do not send this.'],
        env: {
          GC_CITY_PATH: city,
          GC_SESSION_ID: 'fc-chat-1',
          FACTORU_CONVERSATION_SCOPE_ID: 'factoru-rig',
          FACTORU_CONVERSATION_ACCOUNT_ID: 'factoru-server',
          FACTORU_CONVERSATION_ID: 'conv-1',
        },
      }),
      /bare HTTP loopback origin/,
    )
  })
})
