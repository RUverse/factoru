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
| Config reload | `gc reload` | Applies live without restarting the city |
| Rig listing | REST `GET /v0/city/{city}/rigs` | Read of live state |
| Formula validation and preview | REST `/formulas/{name}/validate`, `/preview` | Server-side semantic validation before dispatch |
| Run dispatch | REST `POST /v0/city/{city}/sling` | Returns `workflow_id` and `root_bead_id` for correlation |
| Run observation | REST `/runs/{id}/steps`, `/workflow/{id}` | Carries `gc.formula_hash` and per-step routing |
| Cancellation | REST `POST /runs/{id}/cancel` | Terminal state confirmed by observation, never assumed from the response |
| Events | REST `GET /events` with `after_seq`, and `/events/stream` (SSE) | `seq` is a durable cursor |
| Conversation delivery | REST `extmsg/adapters`, `bind`, `inbound`, `transcript`, `transcript/ack` | See below |
| Cost and usage | REST `GET /v0/city/{city}/usage` | Model cost observable from the first run |

Human-readable CLI output is never parsed. Where the CLI is used it is for
operations that genuinely have no API surface, and every `gc` subcommand
supports `--json` and `--json-schema` when structured output is needed.

### Conversation delivery is a durable cursor, not an SSE subscription

The documented `POST /v0/extmsg/clients` plus per-conversation `subscribe` SSE
stream does not exist in 1.4.0. The real surface registers an adapter, binds a
conversation to an **agent name** — which survives session restarts and
cold-wakes a session at delivery time — posts turns to `extmsg/inbound`, and
reads replies from `extmsg/transcript` using `after_sequence`, acknowledging with
`transcript/ack`.

Factoru adopts the transcript cursor as the authoritative delivery mechanism and
treats an adapter `callback_url` as a latency optimisation only. A cursor that
both sides persist is strictly better for a product whose requirement is that a
desktop disconnect and a server restart never lose a conversation turn.

### Event cursors persist `seq`, not the opaque token

The supervisor returns both a `next_cursor` token and per-event `seq`. Factoru
persists only `seq`: it is a property of the event, whereas the token has no
documented lifetime across supervisor restarts or upgrades. The adapter also
detects sequence gaps, because a gap means the city's event log rotated while
Factoru was down and the projection must be reconciled rather than continued.

## Consequences

- Gas City DTOs, IDs, and header names stay inside `packages/gas-city`.
- Upgrading Gas City is a deliberate act with a re-run gate, not a passive
  dependency bump.
- Factoru cannot offer a "connect to a remote Gas City" feature. Orchestration
  is always host-local to Factoru Server; remoteness is Factoru's own API.
- Because city and rig provisioning use the CLI, Factoru Server must have `gc`
  on its path and cannot manage orchestration purely over HTTP.

## Revisit when

- Gas City publishes an authenticated control plane, which would remove the
  loopback-only constraint.
- A Gas City minor release changes the API surface, which re-runs the gate.
- `extmsg` gains a documented, stable SSE subscription with replay semantics at
  least as strong as the transcript cursor.
