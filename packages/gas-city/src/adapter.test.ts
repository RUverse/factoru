import { describe, expect, it } from 'vitest'

import { GasCityAdapter } from './adapter.js'
import { GasCityError } from './errors.js'
import { SupervisorClient } from './http.js'
import { INITIAL_EVENT_CURSOR, type CityEvent } from './events.js'

/**
 * Contract tests against recorded Gas City 1.4.0 response shapes.
 *
 * These use a fake `fetch` rather than a live supervisor so they run in CI, but
 * every response body here matches the served OpenAPI document — including the
 * parts that are easy to get wrong from the prose docs: `GET /events` has no
 * `after_seq`, list fields are nullable, and the request header is
 * `X-GC-Request-Id`.
 */

interface Recorded {
  status?: number
  body: unknown
  headers?: Record<string, string>
}

function fakeFetch(handler: (url: URL, init: RequestInit) => Recorded) {
  const calls: { url: URL; init: RequestInit }[] = []

  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = input instanceof URL ? input : new URL(String(input))
    calls.push({ url, init })
    const recorded = handler(url, init)
    return new Response(JSON.stringify(recorded.body), {
      status: recorded.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(recorded.headers ?? {}) },
    })
  }) as typeof globalThis.fetch

  return { fn, calls }
}

const adapterWith = (fetchImpl: typeof globalThis.fetch) =>
  new GasCityAdapter({
    client: new SupervisorClient({ baseUrl: 'http://127.0.0.1:8372', fetch: fetchImpl }),
    cityName: 'factoru-spike',
    probe: async () => ({ found: true, output: '1.4.0' }),
  })

const event = (seq: number): CityEvent => ({
  seq,
  type: 'bead.closed',
  ts: '2026-08-05T09:41:27+02:00',
  actor: 'controller',
})

describe('SupervisorClient', () => {
  it('refuses a non-loopback supervisor URL', () => {
    // The control plane declares no authentication at all, so a remote base URL
    // is a security failure rather than a deployment option.
    expect(() => new SupervisorClient({ baseUrl: 'http://10.0.0.5:8372' })).toThrow(GasCityError)
    expect(() => new SupervisorClient({ baseUrl: 'http://127.0.0.1:8372' })).not.toThrow()
  })

  it('sends the anti-CSRF header on mutations but not on reads', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: {} }))
    const client = new SupervisorClient({ baseUrl: 'http://127.0.0.1:8372', fetch: fn })

    await client.get('/city/x/rigs')
    await client.post('/city/x/sling', { target: 't' })

    const headerOf = (i: number) =>
      (calls[i]?.init.headers as Record<string, string> | undefined)?.['X-GC-Request']
    expect(headerOf(0)).toBeUndefined()
    expect(headerOf(1)).toBe('factoru')
  })

  it('maps Problem Details onto a Factoru failure kind and captures the request id', async () => {
    // Body recorded verbatim from a real 422 on /formulas/{name}/preview.
    const { fn } = fakeFetch(() => ({
      status: 422,
      headers: { 'X-GC-Request-Id': 'req-abc123' },
      body: {
        type: 'urn:gascity:error:validation-failed',
        title: 'Validation Failed',
        status: 422,
        detail: 'validation failed',
        errors: [{ message: 'expected required property target to be present' }],
        code: 'validation-failed',
      },
    }))
    const client = new SupervisorClient({ baseUrl: 'http://127.0.0.1:8372', fetch: fn })

    await expect(client.get('/city/x/formulas/f/validate')).rejects.toMatchObject({
      kind: 'invalid_request',
      code: 'validation-failed',
      // Gas City names this X-GC-Request-Id, not X-Request-Id. Without it,
      // an error cannot be found in Gas City's own logs.
      requestId: 'req-abc123',
      retryable: false,
    })
  })

  it('marks an unavailable supervisor retryable and an unreachable one transport', async () => {
    const { fn } = fakeFetch(() => ({ status: 503, body: { detail: 'city starting' } }))
    await expect(
      new SupervisorClient({ baseUrl: 'http://127.0.0.1:8372', fetch: fn }).get('/city/x/status'),
    ).rejects.toMatchObject({ kind: 'unavailable', retryable: true })

    const dead = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof globalThis.fetch
    await expect(
      new SupervisorClient({ baseUrl: 'http://127.0.0.1:8372', fetch: dead }).get('/city/x/status'),
    ).rejects.toMatchObject({ kind: 'transport', retryable: true })
  })
})

describe('GasCityAdapter.readEvents', () => {
  it('pages backwards to the cursor instead of trusting one newest page', async () => {
    // GET /events has no after_seq — only /events/stream does. Reading one page
    // and jumping the cursor to its highest seq would skip everything older,
    // permanently, because the cursor never moves backwards.
    const pages: Record<string, { items: CityEvent[]; next_cursor?: string }> = {
      head: { items: [event(30), event(29)], next_cursor: 'c1' },
      c1: { items: [event(28), event(27)], next_cursor: 'c2' },
      c2: { items: [event(26), event(25)] },
    }

    const { fn, calls } = fakeFetch((url) => ({
      body: pages[url.searchParams.get('cursor') ?? 'head'],
    }))

    const result = await adapterWith(fn).readEvents({ lastHandledSeq: 26 }, { pageSize: 2 })

    expect(result.events.map((e) => e.seq)).toEqual([27, 28, 29, 30])
    expect(result.nextCursor).toEqual({ lastHandledSeq: 30 })
    expect(result.gapDetected).toBe(false)
    // It must not have sent after_seq, which the endpoint ignores.
    expect(calls.every((c) => !c.url.searchParams.has('after_seq'))).toBe(true)
  })

  it('does not report a page boundary as a gap', async () => {
    // Mid-pagination the oldest event seen is always newer than the cursor.
    // Concluding "gap" there would raise a lost-history alarm on every backlog.
    const pages: Record<string, { items: CityEvent[]; next_cursor?: string }> = {
      head: { items: [event(10)], next_cursor: 'c1' },
      c1: { items: [event(9)], next_cursor: 'c2' },
      c2: { items: [event(8)] },
    }
    const { fn } = fakeFetch((url) => ({
      body: pages[url.searchParams.get('cursor') ?? 'head'],
    }))

    const result = await adapterWith(fn).readEvents({ lastHandledSeq: 7 }, { pageSize: 1 })

    expect(result.gapDetected).toBe(false)
    expect(result.events.map((e) => e.seq)).toEqual([8, 9, 10])
  })

  it('reports a gap when history was rotated away below the cursor', async () => {
    // Cursor is at 5 but the oldest retained event is 20 and there are no more
    // pages: 6-19 are gone and no amount of reading will recover them.
    const { fn } = fakeFetch(() => ({ body: { items: [event(21), event(20)] } }))

    const result = await adapterWith(fn).readEvents({ lastHandledSeq: 5 }, { pageSize: 2 })

    expect(result.gapDetected).toBe(true)
  })

  it('stops at maxPages and reports a gap rather than reading unbounded history', async () => {
    let seq = 10_000
    const { fn, calls } = fakeFetch(() => ({
      body: { items: [event(seq--)], next_cursor: `c${seq}` },
    }))

    const result = await adapterWith(fn).readEvents(INITIAL_EVENT_CURSOR, {
      pageSize: 1,
      maxPages: 3,
    })

    expect(calls).toHaveLength(3)
    expect(result.gapDetected).toBe(true)
  })

  it('accepts a null items array', async () => {
    const { fn } = fakeFetch(() => ({ body: { items: null } }))

    const result = await adapterWith(fn).readEvents(INITIAL_EVENT_CURSOR)

    expect(result.events).toEqual([])
    expect(result.gapDetected).toBe(false)
  })
})

describe('GasCityAdapter.verifySupervisorContract', () => {
  it('accepts a supervisor serving every operation Factoru depends on', async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: {
        paths: Object.fromEntries(
          [
            '/v0/city/{cityName}/provider-readiness',
            '/v0/city/{cityName}/rigs',
            '/v0/city/{cityName}/sling',
            '/v0/city/{cityName}/runs/{run_id}/steps',
            '/v0/city/{cityName}/runs/{run_id}/cancel',
            '/v0/city/{cityName}/workflow/{workflow_id}',
            '/v0/city/{cityName}/events',
            '/v0/city/{cityName}/events/stream',
            '/v0/city/{cityName}/usage',
            '/v0/city/{cityName}/extmsg/adapters',
            '/v0/city/{cityName}/extmsg/bind',
            '/v0/city/{cityName}/extmsg/inbound',
            '/v0/city/{cityName}/extmsg/transcript',
            '/v0/city/{cityName}/extmsg/transcript/ack',
          ].map((p) => [p, {}]),
        ),
      },
    }))

    expect(await adapterWith(fn).verifySupervisorContract()).toEqual({ ok: true, missingPaths: [] })
    // The document lives outside the /v0 prefix.
    expect(calls[0]?.url.pathname).toBe('/openapi.json')
  })

  it('names what a numerically-acceptable release stopped serving', async () => {
    // A patch release inside the supported range is not automatically
    // compatible; the version number is not evidence on its own.
    const { fn } = fakeFetch(() => ({ body: { paths: { '/v0/city/{cityName}/rigs': {} } } }))

    const result = await adapterWith(fn).verifySupervisorContract()

    expect(result.ok).toBe(false)
    expect(result.missingPaths).toContain('/v0/city/{cityName}/sling')
  })
})

describe('GasCityAdapter.listRigs', () => {
  it('parses the recorded rigs response', async () => {
    // Recorded from GET /v0/city/{city}/rigs. Fields are lower-snake, prefix
    // may be null, and items itself is nullable.
    const { fn } = fakeFetch(() => ({
      body: {
        items: [
          { name: 'probe', prefix: null, path: '/tmp/repo', default_branch: 'main' },
          { name: 'probe2', prefix: 'p2', path: '/tmp/repo2', default_branch: 'main' },
        ],
      },
    }))

    expect(await adapterWith(fn).listRigs()).toEqual([
      {
        rigName: 'probe',
        beadPrefix: undefined,
        repositoryPath: '/tmp/repo',
        defaultBranch: 'main',
      },
      {
        rigName: 'probe2',
        beadPrefix: 'p2',
        repositoryPath: '/tmp/repo2',
        defaultBranch: 'main',
      },
    ])
  })

  it('accepts a null items array', async () => {
    const { fn } = fakeFetch(() => ({ body: { items: null } }))
    expect(await adapterWith(fn).listRigs()).toEqual([])
  })
})

describe('GasCityAdapter.startRun', () => {
  it('captures the correlation Factoru must persist, including the formula hash', async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.pathname.endsWith('/events')) return { body: { items: [event(1445)] } }
      if (url.pathname.endsWith('/sling')) {
        return {
          body: {
            status: 'slung',
            workflow_id: 'pr-cb9',
            root_bead_id: 'pr-cb9',
            run: { run_id: 'pr-cb9', status: 'pending' },
          },
        }
      }
      return {
        body: {
          workflow_id: 'pr-cb9',
          root_bead_id: 'pr-cb9',
          beads: [
            {
              id: 'pr-cb9',
              title: 'M1 probe run',
              status: 'in_progress',
              metadata: { 'gc.formula_hash': '02b376453d1e', 'gc.kind': 'workflow' },
            },
          ],
        },
      }
    })

    const correlation = await adapterWith(fn).startRun({
      rigName: 'probe',
      formulaName: 'factoru-probe-delivery',
      target: 'probe/factoru.software-implementer',
      title: 'M1 probe run',
      variables: { request: 'Add multiply' },
      requestId: 'dispatch-pr-cb9',
    })

    expect(correlation).toMatchObject({
      cityName: 'factoru-spike',
      rigName: 'probe',
      runId: 'pr-cb9',
      workflowRootBeadId: 'pr-cb9',
      formulaHash: '02b376453d1e',
      // Read before dispatch, so events fired during dispatch are not lost.
      startingEventSeq: 1445,
    })

    const order = calls.map((c) => c.url.pathname)
    expect(order.indexOf('/v0/city/factoru-spike/events')).toBeLessThan(
      order.indexOf('/v0/city/factoru-spike/sling'),
    )
    const sling = calls.find((call) => call.url.pathname.endsWith('/sling'))!
    expect((sling.init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'dispatch-pr-cb9',
    )
  })

  it('still returns a correlation when the formula hash cannot be read', async () => {
    // The run is already durable at that point. Failing the dispatch over a
    // diagnostic field would invite a retry that slings the work twice.
    const { fn } = fakeFetch((url) => {
      if (url.pathname.endsWith('/events')) return { body: { items: [] } }
      if (url.pathname.endsWith('/sling')) {
        return { body: { workflow_id: 'pr-x', root_bead_id: 'pr-x', run: { run_id: 'pr-x' } } }
      }
      return { status: 500, body: { detail: 'projection warming' } }
    })

    const correlation = await adapterWith(fn).startRun({
      rigName: 'probe',
      formulaName: 'f',
      target: 't',
      title: 'x',
      variables: {},
    })

    expect(correlation.runId).toBe('pr-x')
    expect(correlation.formulaHash).toBeUndefined()
  })
})

describe('GasCityAdapter conversation delivery', () => {
  const conversation = {
    scopeId: 'probe',
    accountId: 'factoru-server-1',
    conversationId: 'conv-probe-1',
  }

  it('registers the adapter idempotently', async () => {
    // This runs on every server start; a second adapter identity would split
    // the conversation across two providers.
    const { fn, calls } = fakeFetch(() => ({ body: { status: 'registered' } }))

    await adapterWith(fn).registerConversationAdapter('factoru-server-1', 'Factoru Server')

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('factoru-adapter-factoru-server-1')
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      provider: 'factoru',
      account_id: 'factoru-server-1',
    })
  })

  it('sends every conversation field, including the kind that a 500 depends on', async () => {
    // Omitting `kind` makes 1.4.0 return a 500 rather than a validation error,
    // so a partially-built query surfaces as an unexplained server fault.
    const { fn, calls } = fakeFetch(() => ({ body: { items: [] } }))

    await adapterWith(fn).readConversation(conversation, 0)

    const params = calls[0]!.url.searchParams
    expect(Object.fromEntries(params)).toMatchObject({
      scope_id: 'probe',
      provider: 'factoru',
      account_id: 'factoru-server-1',
      conversation_id: 'conv-probe-1',
      kind: 'dm',
      after_sequence: '0',
    })
  })

  it('maps a recorded transcript onto Factoru roles', async () => {
    // Recorded verbatim from a real round trip against 1.4.0.
    const { fn } = fakeFetch(() => ({
      body: {
        items: [
          {
            Sequence: 1,
            Kind: 'inbound',
            Text: 'In one sentence, what does index.js export?',
            ProviderMessageID: 'm1',
            ReplyToMessageID: '',
            CreatedAt: '2026-08-05T11:00:00Z',
            Actor: { id: 'user-1', display_name: 'Alireza', is_bot: false },
          },
          {
            Sequence: 2,
            Kind: 'outbound',
            Text: '`index.js` exports add, subtract, and multiply.',
            ProviderMessageID: 'mayor-conv-probe-1-m1',
            ReplyToMessageID: 'm1',
            CreatedAt: '2026-08-05T11:08:55Z',
            Actor: { id: 'mayor', display_name: 'mayor', is_bot: true },
          },
        ],
        total: 2,
      },
    }))

    const messages = await adapterWith(fn).readConversation(conversation, 0)

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[1]).toMatchObject({
      sequence: 2,
      authorDisplayName: 'mayor',
      inReplyToMessageId: 'm1',
    })
  })

  it('surfaces the named-session requirement rather than silently doing nothing', async () => {
    // 1.4.0 rejects an agent binding when the agent has no configured named
    // session. Factoru must see that as a configuration error it can report.
    const { fn } = fakeFetch(() => ({
      status: 400,
      body: {
        type: 'urn:gascity:error:invalid-request',
        detail:
          'agent "probe/factoru.project-manager-chat" does not resolve to a configured named session; agent bindings require a named-session-backed agent',
        code: 'invalid-request',
      },
    }))

    await expect(
      adapterWith(fn).bindConversation(conversation, 'probe/factoru.project-manager-chat'),
    ).rejects.toMatchObject({ kind: 'invalid_request', code: 'invalid-request' })
  })

  it('accepts a null transcript', async () => {
    const { fn } = fakeFetch(() => ({ body: { items: null } }))
    expect(await adapterWith(fn).readConversation(conversation, 5)).toEqual([])
  })
})

describe('GasCityAdapter.describeRun', () => {
  it('maps recorded step statuses and keeps the caller-supplied root bead id', async () => {
    const { fn } = fakeFetch(() => ({
      body: {
        run_id: 'pr-cb9',
        steps: [
          { id: 'pr-q59', title: 'Implement', status: 'completed' },
          { id: 'pr-20f', title: 'Review', status: 'active' },
          { id: 'pr-djz', title: 'Finalize', status: 'pending' },
        ],
      },
    }))

    const snapshot = await adapterWith(fn).describeRun('pr-cb9', 'root-bead-1')

    expect(snapshot.workflowRootBeadId).toBe('root-bead-1')
    expect(snapshot.steps.map((s) => s.status)).toEqual(['completed', 'running', 'pending'])
    expect(snapshot.partial).toBe(false)
  })

  it('keeps a requested cancellation non-terminal', async () => {
    // Reporting `canceling` as `cancelled` would let Factoru close a task while
    // its agent is still running and still spending money.
    const { fn } = fakeFetch(() => ({
      body: { run_id: 'r', steps: [{ id: 's', title: 't', status: 'canceling' }] },
    }))

    expect((await adapterWith(fn).describeRun('r', 'root')).steps[0]?.status).toBe('cancelling')
  })

  it('does not read an unrecognised status as a terminal state', async () => {
    const { fn } = fakeFetch(() => ({
      body: { run_id: 'r', steps: [{ id: 's', title: 't', status: 'something-new' }] },
    }))

    expect((await adapterWith(fn).describeRun('r', 'root')).steps[0]?.status).toBe('unknown')
  })

  it('reports a warming projection as partial rather than as no steps', async () => {
    const { fn } = fakeFetch(() => ({ body: { run_id: 'r', steps: null } }))

    const snapshot = await adapterWith(fn).describeRun('r', 'root')
    expect(snapshot.steps).toEqual([])
    expect(snapshot.partial).toBe(true)
  })
})
