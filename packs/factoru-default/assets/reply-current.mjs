#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function required(value, label) {
  if (!value?.trim()) throw new Error(`Factoru reply requires ${label}`)
  return value.trim()
}

function parseBody(argv) {
  let body = ''
  let bodyFile = ''
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--body') body = argv[++index] ?? ''
    else if (argv[index] === '--body-file') bodyFile = argv[++index] ?? ''
    else throw new Error(`Unknown argument: ${argv[index]}`)
  }
  if (body && bodyFile) throw new Error('Use either --body or --body-file, not both')
  const value = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : body
  if (!value.trim()) throw new Error('Factoru reply body must not be empty')
  if (value.length > 60_000) throw new Error('Factoru reply body is too large')
  return value
}

function runtimeConfiguration(cityPath) {
  const file = path.join(cityPath, '.gc', 'factoru-server.json')
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Factoru runtime configuration must be a private regular file')
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function loopbackOrigin(raw) {
  const url = new URL(required(raw, 'Gas City supervisor URL'))
  const hosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  if (
    url.protocol !== 'http:' ||
    !hosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Gas City supervisor URL must be a bare HTTP loopback origin')
  }
  return url.origin
}

async function jsonRequest(fetchImpl, url, init = undefined) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) })
  const text = await response.text()
  const result = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`Gas City request failed (${response.status}): ${text.slice(0, 500)}`)
  }
  return result
}

async function latestInboundMessageId(fetchImpl, baseUrl, cityName, conversation) {
  let afterSequence = 0
  let latest = ''
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(`/v0/city/${encodeURIComponent(cityName)}/extmsg/transcript`, `${baseUrl}/`)
    for (const [key, value] of Object.entries(conversation)) url.searchParams.set(key, value)
    url.searchParams.set('after_sequence', String(afterSequence))
    url.searchParams.set('limit', '100')
    const result = await jsonRequest(fetchImpl, url)
    const items = Array.isArray(result?.items) ? result.items : []
    let advanced = false
    for (const item of items) {
      const sequence = Number(item?.Sequence)
      if (Number.isSafeInteger(sequence) && sequence > afterSequence) {
        afterSequence = sequence
        advanced = true
      }
      if (item?.Kind === 'inbound' && typeof item.ProviderMessageID === 'string') {
        latest = item.ProviderMessageID
      }
    }
    if (items.length < 100 || !advanced) break
  }
  return required(latest, 'a delivered inbound message')
}

export async function publishCurrentReply({
  argv = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const body = parseBody(argv)
  const cityPath = required(env.GC_CITY_PATH ?? env.GC_CITY, 'GC_CITY_PATH')
  const sessionId = required(env.GC_SESSION_ID, 'GC_SESSION_ID')
  const conversation = {
    scope_id: required(env.FACTORU_CONVERSATION_SCOPE_ID, 'conversation scope'),
    provider: 'factoru',
    account_id: required(env.FACTORU_CONVERSATION_ACCOUNT_ID, 'conversation account'),
    conversation_id: required(env.FACTORU_CONVERSATION_ID, 'conversation ID'),
    kind: 'dm',
  }
  const runtime = runtimeConfiguration(cityPath)
  if (runtime.version !== 2) throw new Error('Factoru runtime configuration is incompatible')
  const baseUrl = loopbackOrigin(runtime.gasCitySupervisorUrl)
  const cityName = required(runtime.cityName, 'Gas City city name')
  const replyTo = await latestInboundMessageId(fetchImpl, baseUrl, cityName, conversation)
  const idempotencyKey = createHash('sha256')
    .update([sessionId, replyTo, body].join('\0'))
    .digest('hex')
  const result = await jsonRequest(
    fetchImpl,
    new URL(`/v0/city/${encodeURIComponent(cityName)}/extmsg/outbound`, `${baseUrl}/`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GC-Request': 'factoru-reply' },
      body: JSON.stringify({
        session_id: sessionId,
        conversation,
        text: body,
        reply_to_message_id: replyTo,
        idempotency_key: idempotencyKey,
      }),
    },
  )
  if (result?.Receipt?.Delivered !== true || !result?.TranscriptEntry) {
    throw new Error(
      `Gas City did not record the reply (${String(result?.Receipt?.FailureKind ?? 'unknown')})`,
    )
  }
  return {
    delivered: true,
    messageId: result.Receipt.MessageID,
    sequence: result.TranscriptEntry.Sequence,
    replyTo,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishCurrentReply({ argv: process.argv.slice(2) }).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      process.stderr.write(
        `gc factoru reply-current: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      process.exitCode = 1
    },
  )
}
