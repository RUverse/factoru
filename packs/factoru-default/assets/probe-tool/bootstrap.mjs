#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverFactoruServerUrl } from './server-url.mjs'

const workdir = path.resolve(process.argv[2] ?? process.cwd())
const serverUrl = discoverFactoruServerUrl({ workdir })
const rigName = process.env.GC_RIG
const agentName = process.env.GC_AGENT ?? process.env.GC_TEMPLATE
const sessionId = process.env.GC_SESSION_ID ?? process.env.GC_SESSION_NAME

if (!rigName || !agentName || !sessionId) {
  throw new Error(
    'Factoru tools require GC_RIG, GC_AGENT/GC_TEMPLATE, and GC_SESSION_ID/GC_SESSION_NAME',
  )
}

const response = await fetch(`${serverUrl}/internal/v1/agent-tools/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rigName, agentName, sessionId }),
  signal: AbortSignal.timeout(10_000),
})
if (!response.ok) throw new Error(`Factoru credential request failed (${response.status})`)
const credential = await response.json()
const toolServer = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs')
const environment = {
  FACTORU_AGENT_TOKEN: credential.token,
  FACTORU_SERVER_URL: serverUrl,
}

fs.writeFileSync(
  path.join(workdir, '.mcp.json'),
  `${JSON.stringify(
    { mcpServers: { 'factoru-tools': { command: 'node', args: [toolServer], env: environment } } },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
)
const codexDirectory = path.join(workdir, '.codex')
fs.mkdirSync(codexDirectory, { recursive: true })
const tomlString = (value) => JSON.stringify(value)
fs.writeFileSync(
  path.join(codexDirectory, 'config.toml'),
  `[mcp_servers.factoru-tools]\ncommand = "node"\nargs = [${tomlString(toolServer)}]\n\n` +
    `[mcp_servers.factoru-tools.env]\nFACTORU_AGENT_TOKEN = ${tomlString(credential.token)}\n` +
    `FACTORU_SERVER_URL = ${tomlString(serverUrl)}\n`,
  { mode: 0o600 },
)

process.stdout.write(
  `factoru: installed scoped tools for ${credential.role} (${credential.projectId})\n`,
)
