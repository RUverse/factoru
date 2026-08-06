#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2024-11-05'
const token = process.env.FACTORU_AGENT_TOKEN
const serverUrl = (process.env.FACTORU_SERVER_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')

if (!token) {
  process.stderr.write('factoru-tools: refusing to start without a session credential\n')
  process.exit(1)
}

const object = (properties, required = []) => ({ type: 'object', properties, required })
const string = (description) => ({ type: 'string', description })
const TOOLS = [
  {
    name: 'factoru_tasks_get',
    description: 'Read one task in the authenticated Factoru project.',
    inputSchema: object({ taskId: string('Stable Factoru task ID.') }, ['taskId']),
  },
  {
    name: 'factoru_tasks_search',
    description: 'Search active and recent tasks for likely or possible duplicate intent.',
    inputSchema: object(
      { query: string('Candidate title or request text.'), limit: { type: 'number' } },
      ['query'],
    ),
  },
  {
    name: 'factoru_tasks_create',
    description:
      'Create a Backlog task, or Queue it only when the user explicitly requested planning.',
    inputSchema: object(
      {
        title: string('Short task title.'),
        description: string('Acceptance criteria and context.'),
        status: { type: 'string', enum: ['backlog', 'queue'] },
      },
      ['title'],
    ),
  },
  {
    name: 'factoru_tasks_update',
    description: 'Update task intent or planning fields inside the authenticated project.',
    inputSchema: object(
      {
        taskId: string('Task to update.'),
        title: string('Updated title.'),
        description: string('Updated criteria and context.'),
        priority: { type: 'number', minimum: 0, maximum: 100 },
        queuePhase: {
          type: 'string',
          enum: ['awaiting_triage', 'triaging', 'ready', 'waiting_dependency', 'waiting_capacity'],
        },
        workerTypeKind: {
          type: ['string', 'null'],
          enum: ['project_manager', 'software_engineer', null],
        },
        formulaName: { type: ['string', 'null'] },
        needsYouAction: {
          type: 'string',
          enum: ['clarify', 'approve', 'review', 'resolve_conflict', 'recover_failure'],
        },
        needsYouMessage: string('Exact action requested from the user.'),
      },
      ['taskId'],
    ),
  },
  {
    name: 'factoru_tasks_move',
    description:
      'Move a task among the four active states. Needs you requires an exact action and message.',
    inputSchema: object(
      {
        taskId: string('Task to move.'),
        status: { type: 'string', enum: ['backlog', 'queue', 'in_progress', 'needs_you'] },
        needsYouAction: {
          type: 'string',
          enum: ['clarify', 'approve', 'review', 'resolve_conflict', 'recover_failure'],
        },
        needsYouMessage: string('Exact action requested from the user.'),
      },
      ['taskId', 'status'],
    ),
  },
  {
    name: 'factoru_tasks_queue',
    description: 'Explicitly request Project Manager reconciliation for a task.',
    inputSchema: object({ taskId: string('Task to Queue.') }, ['taskId']),
  },
  {
    name: 'factoru_tasks_set_dependencies',
    description: 'Replace a task dependency set with project-local task IDs.',
    inputSchema: object(
      {
        taskId: string('Dependent task.'),
        dependencyIds: { type: 'array', items: { type: 'string' } },
      },
      ['taskId', 'dependencyIds'],
    ),
  },
  {
    name: 'factoru_tasks_propose_merge',
    description:
      'Propose a task merge for explicit user confirmation. This never merges by itself.',
    inputSchema: object(
      {
        sourceTaskId: string('Task that would be superseded.'),
        targetTaskId: string('Task that would remain.'),
        reason: string('Why these requests appear equivalent.'),
      },
      ['sourceTaskId', 'targetTaskId', 'reason'],
    ),
  },
  {
    name: 'factoru_tasks_resolve',
    description:
      'Resolve a task as accepted, rejected, or cancelled. Agents cannot supersede/merge tasks.',
    inputSchema: object(
      {
        taskId: string('Task to resolve.'),
        resolution: { type: 'string', enum: ['accepted', 'rejected', 'cancelled'] },
        summary: string('Durable reason for the terminal outcome.'),
      },
      ['taskId', 'resolution', 'summary'],
    ),
  },
]

const names = new Map(
  TOOLS.map((tool) => [tool.name, `tasks.${tool.name.replace(/^factoru_tasks_/, '')}`]),
)

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function callTool(id, name, args) {
  const tool = names.get(name)
  if (!tool) {
    send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown Factoru tool ${name}` } })
    return
  }
  try {
    const response = await fetch(`${serverUrl}/internal/v1/agent-tools/call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: `mcp_${randomUUID()}`, tool, arguments: args ?? {} }),
      signal: AbortSignal.timeout(30_000),
    })
    const payload = await response.json()
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload.ok ? payload.result : payload.error, null, 2),
          },
        ],
        isError: !payload.ok,
      },
    })
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `Factoru tool gateway: ${String(error)}` },
    })
  }
}

async function handle(request) {
  const { id, method, params } = request
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'factoru-tools', version: '0.2.0' },
      },
    })
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
  } else if (method === 'tools/call') {
    await callTool(id, params?.name, params?.arguments)
  } else if (id !== undefined && id !== null) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unsupported method ${String(method)}` },
    })
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  void handle(request)
})
