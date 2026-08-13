# 0007 — Gas City compatibility policy and adapter transport map

**Status:** Accepted (Milestone 1)
**Date:** 2026-08-05

## Context

The roadmap required Factoru to pin "a tested Gas City binary/CLI release and the
authoritative OpenAPI schema linked from that release or official repository; do
not trust a generic docs placeholder", and to record which adapter operations use
typed REST/SSE, validated config generation, or pinned `gc --json`.

The feasibility gate answered both questions with evidence, and found that the
published documentation and the shipped binary disagree in ways that matter.
See [the spike record](../spikes/milestone-1-gas-city-gate.md).

## Decision

### Pin the binary, and read the contract the binary serves

Factoru pins Gas City **1.4.0** and accepts patch movement within that minor
(`>=1.4.0 <1.5.0`). A minor or major change re-opens the feasibility gate rather
than being accepted as an improvement, because the API contract is what Factoru
was verified against.

The authoritative OpenAPI document is the one **served by the running
supervisor** at `/openapi.json`, not a copy from the documentation site. The
running binary published 127 paths under `/v0/city/{cityName}/…`; the docs site
describes external-messaging paths that do not exist in 1.4.0 at all. A contract
produced by the process Factoru is talking to cannot drift from it.

Dependencies are pinned with floors only where there is a documented reason.
Dolt's `2.1.0` floor is enforced because older builds can hang under write load
instead of failing fast. tmux, git, jq, and flock are required to exist but
carry no invented floor.

### Treat the supervisor as unauthenticated and host-local

The served OpenAPI declares no security schemes. `X-GC-Request` is an anti-CSRF
presence check, not authorization. `SupervisorClient` therefore **refuses a
non-loopback base URL at construction**, rather than trusting deployment
configuration to keep an unauthenticated control plane off the network.

Factoru never proxies the supervisor, its dashboard, or managed Dolt to a
desktop client. Remote access is only ever through Factoru's own authenticated
API.

### Transport map

| Operation | Transport | Why |
| --- | --- | --- |
| Readiness of `gc`, `dolt`, `bd`, tmux, git, jq, flock | Process probe | Must work when no supervisor is running, so "gc is not installed" is reportable |
| Provider/harness readiness | REST `GET /v0/city/{city}/provider-readiness` | Gas City owns harness probing; `gc init` enforces it as a precondition |
| City creation, rig registration, pack import/lock | Pinned `gc` CLI | These write configuration and run multi-step bootstrap (`bd init`, route generation) that has no REST equivalent |
| Config validation/reload | `gc config show --validate`, then `gc reload` | Reject generated configuration before applying it; reload applies a validated byte change without restarting the city |
| Rig listing | REST `GET /v0/city/{city}/rigs` | Read of live state |
| Formula validation and preview | Factoru Formula v2 validation plus REST `/formulas/{name}/preview` | Factoru enforces semantics missing from 1.4.0, then snapshots the runtime-resolved graph before dispatch |
| Run dispatch | REST `POST /v0/city/{city}/sling` | Returns `workflow_id` and `root_bead_id` for correlation |
| Run observation | REST `/runs/{id}/steps`, `/workflow/{id}` | Carries `gc.formula_hash` and per-step routing |
| Cancellation | REST `POST /runs/{id}/cancel` | Terminal state confirmed by observation, never assumed from the response |
| Events | Persistent REST `/events/stream?after_seq=…` (SSE); bounded `GET /events` only for diagnostics/tests | `seq` is a durable cursor; the paginated endpoint has no `after_seq` |
| Conversation delivery | REST `extmsg/adapters`, `bind`, `inbound`, `outbound`, `transcript`, `transcript/ack` | See below |
| Cost and usage | Token-bearing streamed `worker.operation` events, with structured session transcripts as the 1.4.0 fallback | Observed totals and their completeness are durable without requiring an unused city-wide usage endpoint |

Human-readable CLI output is never parsed. Where the CLI is used it is for
operations that genuinely have no API surface, and every `gc` subcommand
supports `--json` and `--json-schema` when structured output is needed.
On server start, city bootstrap replaces only the Factoru-owned root and
registered-rig import bindings before `import install`. It runs `gc import
check` and `gc config show --validate` before reload or start. Rig bindings are
removed first because Gas City validates the combined lock graph during each
add. This ensures every promoted Git SHA follows the current trusted server
deployment while preserving unrelated city imports and provider configuration.
Factoru startup and the operator doctor also verify configured-provider
readiness and the OpenAPI document served by the live supervisor. A mismatch
pauses orchestration with actionable diagnostics while the Factoru API and
stored project history remain available.

### Conversation delivery is a durable cursor, not an SSE subscription

The documented `POST /v0/extmsg/clients` plus per-conversation `subscribe` SSE
stream does not exist in 1.4.0 — that absence is the one part of this section
the gate directly established. The real surface registers an adapter, binds a
conversation to an **agent name**, posts turns to `extmsg/inbound`, and reads
replies from `extmsg/transcript` using `after_sequence`, acknowledging with
`transcript/ack`.

Factoru adopts the transcript cursor as the authoritative delivery mechanism and
treats the adapter `callback_url` as the host-local acceptance boundary for
assistant replies. The Project Manager calls the pack-defined
`gc factoru reply-current` command, which posts to `extmsg/outbound`; Gas City
appends `/publish` to the registered callback base, calls the Factoru acceptance
route, and records the accepted reply in the transcript.
Factoru still advances product state only from the durable transcript cursor. A
cursor that both sides persist is the better fit for a product whose requirement
is that a desktop disconnect and a server restart never lose a conversation
turn.

**Verified in Milestone 3 and revalidated on Linux arm64.** Agent-name binding,
cold delivery, callback-backed outbound publishing, transcript correlation, and
strict cursor resume have completed real provider-backed round trips. The
callback returns a stable provider message ID for idempotent retries and never
writes Factoru transcript state directly.

### Usage events have one server-owned resumable lifecycle

Factoru Server owns one persistent city event consumer while it is running. It
resumes `/events/stream` from the minimum durable active-run `seq`, advances
every active run cursor transactionally, and atomically folds matching
`worker.operation` token/cost deltas. Duplicate delivery is harmless. A
disconnect or sequence jump preserves observed totals but marks them partial; a
heartbeat after replay marks the stream current unless a permanent history gap
or transcript error remains.

Gas City 1.4.0 sessions that do not emit token-bearing worker events use
structured transcript usage as a fallback. Source, stream-current, gap, and
transcript-error state stay private to telemetry persistence; Desktop receives
only Factoru's normalized usage totals, pricing state, and `partial` flag.
`GET /events` remains a bounded newest-first diagnostic surface and does not
participate in production accounting.

### Pinned 1.4.0 configuration and Formula compatibility notes

- Rig patch tables intentionally use bare agent names. Formula routes retain
  binding-qualified identities; changing the patch keys breaks the pinned
  release's rig lookup.
- Factoru formulas use canonical `formulas/<name>.toml` names, omit deprecated
  `contract = "graph.v2"`, and declare `[requires] formula_compiler =
  ">=2.0.0"`.
- These are compatibility rules for the pinned release, not evidence that the
  complete live Milestone 8 acceptance matrix has passed.

## Consequences

- Gas City DTOs, IDs, and header names stay inside `packages/gas-city`.
- Upgrading Gas City is a deliberate act with a re-run gate, not a passive
  dependency bump.
- Factoru cannot offer a "connect to a remote Gas City" feature. Orchestration
  is always host-local to Factoru Server; remoteness is Factoru's own API.
- Because city and rig provisioning use the CLI, Factoru Server must have `gc`
  on its path and cannot manage orchestration purely over HTTP.
- Usage displayed as partial is an observed lower bound, not a finalized total.

## Revisit when

- Gas City publishes an authenticated control plane, which would remove the
  loopback-only constraint.
- A Gas City minor release changes the API surface, which re-runs the gate.
- `extmsg` gains a documented, stable SSE subscription with replay semantics at
  least as strong as the transcript cursor.
