#!/usr/bin/env node
/**
 * Milestone 1 Factoru probe tool.
 *
 * A minimal MCP stdio server whose only purpose is to prove that a Gas City
 * agent can call a Factoru-owned tool, through both the Claude and Codex
 * harnesses, before any real product tool contract is designed.
 *
 * It deliberately exposes fixed development data and no product API. Inventing
 * the task API here would mean designing Factoru's most security-sensitive
 * surface inside a throwaway probe, and then discovering the transport
 * constraints afterwards.
 *
 * Two things it must nonetheless model, because they are the parts that are
 * expensive to retrofit:
 *
 * 1. **Authentication.** The server refuses to start without
 *    `FACTORU_PROBE_TOKEN` and rejects calls that do not present it. A tool
 *    surface that is unauthenticated during the spike teaches the wrong shape.
 * 2. **Scope.** The token is bound to one project and one role, and the server
 *    echoes both back, so the round trip demonstrates that Factoru — not the
 *    model — decides what an agent identity may see.
 *
 * Transport is JSON-RPC 2.0 over newline-delimited stdio, which is what both
 * harnesses launch for a `stdio` MCP server.
 */

import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2024-11-05'

const token = process.env.FACTORU_PROBE_TOKEN
const projectId = process.env.FACTORU_PROBE_PROJECT ?? 'unknown-project'
const role = process.env.FACTORU_PROBE_ROLE ?? 'unknown-role'

if (!token) {
  // Fail loudly at startup rather than serving an unauthenticated tool. A
  // silent fallback here would be indistinguishable from working.
  process.stderr.write(
    'factoru-probe: refusing to start without FACTORU_PROBE_TOKEN. ' +
      'Factoru issues a short-lived, project- and role-scoped token per session.\n',
  )
  process.exit(1)
}

const TOOL = {
  name: 'factoru_probe',
  description:
    'Returns fixed Factoru development data. Proves the Factoru tool bridge is reachable. ' +
    'It has no product meaning and reads no real project state.',
  inputSchema: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'The probe token Factoru issued for this session.',
      },
      note: {
        type: 'string',
        description: 'Optional text echoed back, so a caller can prove which call it made.',
      },
    },
    required: ['token'],
  },
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, payload) {
  send({ jsonrpc: '2.0', id, result: payload })
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function callProbe(id, args) {
  // Compared as a plain string: this is a development probe, and pretending a
  // constant-time comparison makes a throwaway token safe would be theatre.
  // The real tool gateway authenticates in Factoru Server, not here.
  if (args?.token !== token) {
    failure(id, -32602, 'factoru_probe: invalid or missing token for this session')
    return
  }

  result(id, {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            ok: true,
            project_id: projectId,
            role,
            note: args.note ?? null,
            message:
              'Factoru probe tool reached. This is fixed development data, not project state.',
          },
          null,
          2,
        ),
      },
    ],
  })
}

function handle(request) {
  const { id, method, params } = request

  switch (method) {
    case 'initialize':
      result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'factoru-probe', version: '0.1.0' },
      })
      return

    case 'tools/list':
      result(id, { tools: [TOOL] })
      return

    case 'tools/call':
      if (params?.name !== TOOL.name) {
        failure(id, -32602, `factoru_probe: unknown tool ${String(params?.name)}`)
        return
      }
      callProbe(id, params.arguments ?? {})
      return

    default:
      // Notifications carry no id and must not be answered at all.
      if (id === undefined || id === null) return
      failure(id, -32601, `factoru_probe: unsupported method ${String(method)}`)
  }
}

const lines = createInterface({ input: process.stdin })

lines.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let request
  try {
    request = JSON.parse(trimmed)
  } catch {
    // No id is recoverable from unparsable input, so there is nothing to
    // answer; dropping it is the only correct response.
    return
  }

  try {
    handle(request)
  } catch (error) {
    if (request?.id !== undefined && request?.id !== null) {
      failure(request.id, -32603, `factoru_probe: ${String(error)}`)
    }
  }
})
