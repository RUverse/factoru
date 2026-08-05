# Milestone 1 — Gas City feasibility gate

> Status: **pass**
>
> The dependency is viable and every exit criterion was met against a real
> installation: city and rig provisioning, live config reload, pinned pack
> import, Formula v2 routing two steps to two agent bindings across a real
> `needs` edge, a complete implement → review → finalize run, event cursors
> across a supervisor restart, cost reporting, a full Project Manager
> conversation round trip, and an authenticated role-scoped Factoru tool call
> from both the Claude and Codex harnesses.
>
> The go decision is go. Several assumptions the architecture carried were
> disproven along the way and are recorded below; the roadmap and architecture
> have been corrected to match what the runtime actually does.
> Runtime: Gas City 1.4.0 (Homebrew), macOS arm64 (Darwin 25.5.0)
> Disposable state only. No Factoru product persistence exists yet.

This is the evidence record for the Gas City feasibility gate. It exists so the
go/no-go decision rests on what was observed rather than on what the
documentation promises, and so the next person can tell the difference between
"proven", "disproven", and "not yet tried".

Everything here was produced against a real Gas City installation and a
disposable Git repository. Nothing in this document is inferred from the docs
site alone; where the docs and the running binary disagree, that disagreement is
itself recorded as a finding.

## Environment under test

| Component | Version | Source |
| --- | --- | --- |
| Gas City (`gc`) | 1.4.0 | `brew install gascity` |
| Beads (`bd`) | 1.1.2 | Homebrew dependency |
| Dolt | 2.2.3 | Homebrew dependency (floor is 2.1.0) |
| tmux | 3.7b | Homebrew dependency |
| flock | 0.4.0 | Homebrew dependency |
| Claude Code harness | installed | `provider-readiness` reported `configured` after login |
| Codex harness | installed | `provider-readiness` reported `configured` |

`brew install gascity` installs the whole dependency chain, which makes it the
supported installation path for Factoru Server hosts. Direct binary downloads do
not pull dependencies.

## What was proven

### The supervisor serves its own API contract

A running supervisor publishes OpenAPI 3.1 at `/openapi.json` — 127 paths,
titled `Gas City Supervisor API`. This resolves the open question about which
OpenAPI artifact to pin: **Factoru reads the document served by the binary it is
actually talking to**, not a copy from the documentation site. The two are not
equivalent (see [divergence](#the-documented-external-client-protocol-does-not-exist-in-140)).

The API is city-scoped under `/v0/city/{cityName}/…`. Mutations require the
`X-GC-Request` header; the server checks only that it is present.

### The control plane is unauthenticated

The served OpenAPI declares **no `securitySchemes` and no top-level `security`**.
The supervisor binds to `127.0.0.1:8372` and its managed Dolt to
`127.0.0.1:28156`. Both are loopback-only.

This confirms the architecture's existing security position and hardens it into
code: `SupervisorClient` refuses a non-loopback base URL outright. An
unauthenticated orchestration control plane reachable from another machine is
not a deployment option Factoru can offer, so it is rejected at construction
rather than left to configuration discipline.

### City and rig provisioning, and live config reload

`gc init --template gascity --providers codex --default-provider codex --no-start`
creates a city containing `pack.toml`, `city.toml`, `.gc/site.toml`,
`.gc/settings.json`, and `agents/`. `gc start` registers it with the machine
supervisor and installs a launchd agent at
`~/Library/LaunchAgents/com.gascity.supervisor.plist`.

Two rigs were registered against disposable repositories. After
`gc import install`, `gc reload` applied configuration changes **without
restarting the city or dropping live sessions** (`Config reloaded: 64 agents,
2 rigs`). Rig-scoped agents are addressed as `<rig>/<import-alias>.<agent>`.

Pack imports are pinned by commit SHA in `packs.lock`, including local
`file://` sources. The Factoru pack was imported and pinned this way.

### Formula v2 routes real steps to distinct agent bindings

The provisional `factoru-probe-delivery` formula materialised into three beads
with real `needs` edges:

| Bead | Step | `gc.routed_to` |
| --- | --- | --- |
| `pr-gqw` | implement | `probe/factoru.software-implementer` |
| `pr-d2q` | review | `probe/factoru.software-reviewer` |
| `pr-12f` | workflow-finalize | `probe/core.control-dispatcher` |

The review bead stayed `pending` until the implement bead closed, then became
ready and its own session started. The dependency edge is enforced by Gas City,
not by polling on Factoru's side.

The implementer made a real change (`export const subtract = (a, b) => a - b;`)
and the independent reviewer produced a genuinely useful verdict — it correctly
verified the implementation and flagged an out-of-scope `.gitignore` change,
which was in fact Gas City's own mutation rather than the implementer's.

Step routing is expressed as `metadata = { "gc.run_target" = "…" }`, not as a
dedicated routing field. This is not in the published Formula v2 summary and was
read from the shipped `gascity` pack's own formulas.

### Run correlation is durable and version-stamped

Gas City stamps the workflow root bead with `gc.formula_hash`,
`gc.formula_name`, `gc.formula_contract`, `gc.root_store_ref`, and every
resolved `gc.var.*`. That hash is the formula's version identity, which is
exactly what a Factoru `task_run` must persist so a completed run stays
explainable after the formula file changes.

### Events carry a durable, resumable sequence

`GET /v0/city/{city}/events` returns `{items:[{seq,type,ts,actor,subject,
payload}], total, next_cursor}`. `/events/stream` accepts `after_seq` and
`Last-Event-ID`.

Factoru persists only `seq`. The opaque `next_cursor` token has no documented
lifetime across supervisor restarts, whereas `seq` is a property of the event
itself.

### Cost is observable

`GET /v0/city/{city}/usage` reports invocations, input/output/cache tokens, wall
seconds, and `cost_usd_estimate`, with `source: "local_estimate"`. Model cost is
therefore observable from the first autonomous run, as the roadmap requires.

## What was disproven or diverged from the plan

### `gc rig add` commits to the target repository and captures staged work

This is the most serious finding, and it was reproduced deliberately.

`gc rig add <path>` runs `bd init`, which creates a real commit in the target
repository titled `bd init: initialize beads issue tracking`. On a repository
with a **staged** change, that commit **included the user's staged file** and
left the index empty. The user's work was committed under Gas City's message.

Registering a project is a routine product action in Factoru. It cannot silently
rewrite the user's history, and this violates the standing invariant to preserve
unrelated working-tree changes.

**Mitigation, implemented in `packages/gas-city/src/rig-safety.ts`:** Factoru
refuses to register a repository whose index is dirty, and always discloses the
full mutation list first. Unstaged and untracked files are unaffected by the
commit, so they are disclosed rather than blocking.

Mutations Gas City makes in a registered repository:

- `.beads/` (bead store configuration plus local runtime state)
- `.beads/identity.toml` (new, git-tracked project identity)
- `.beads/config.yaml`, `.beads/metadata.json`
- `.gitignore` (appended: ignores `.beads/*` except `identity.toml`)
- one commit: `bd init: initialize beads issue tracking`

### An agent without the role-worker protocol stalls the workflow silently

The first probe run reached the review step, and the reviewer produced a correct
verdict — then stopped. The bead was never closed, the `needs` edge never
released, and the workflow never finalised. **No error was raised anywhere.**

The cause is that Gas City's `graph.v2` execution protocol — claim the routed
bead with `gc hook --claim --json`, set the requested `gc.outcome` metadata,
`bd close` the same bead, then continue or `gc runtime drain-ack` — lives
entirely in the `gc-role-worker` prompt fragment. An agent defined with only a
role description does its work and exits.

**Mitigation:** `packs/factoru-default` now imports `gascity/roles` and every
executing agent's prompt begins with `{{ template "gc-role-worker" . }}`. The
fragment is imported rather than copied; it is roughly two hundred lines of
Gas City-owned claim shell that a copy would silently drift from.

This is a permanent constraint on Factoru's Worker Type contract, not a probe
detail: any agent Factoru binds to a Formula step must carry this protocol.

### No Git worktree was created for the run

`git worktree list` showed only the main worktree throughout. The implementer
and reviewer both ran with `work_dir` set to the rig's primary repository path.

The architecture's preferred split assumed Gas City owns worktree
creation and cleanup. That is **not true for an ordinary Formula v2 workflow**.
The Formula guide ties separate worktrees to `[steps.drain] context = "separate"`
fan-out units, which this probe does not use.

Consequences for the single-task production loop, where there is one run and no
fan-out: either Factoru adopts the drain pattern purely to obtain a worktree, or
Factoru owns worktree creation and passes the validated path to Gas City. The
architecture's documented fallback is now the evidence-backed option. This is
recorded as [ADR 0007](../adr/0007-worktree-ownership.md).

### The documented external-client protocol does not exist in 1.4.0

The published connected-clients guide describes `POST /v0/extmsg/clients`
returning a bearer token, and
`GET /v0/extmsg/llm-client/{account_id}/{conversation_id}/subscribe` as an SSE
reply stream.

**Neither path exists in the 1.4.0 supervisor API.** What exists is:

| Path | Purpose |
| --- | --- |
| `POST /v0/city/{city}/extmsg/adapters` | Register an adapter (`provider`, `account_id`, optional `callback_url`, `Idempotency-Key`) |
| `POST /v0/city/{city}/extmsg/bind` | Bind a conversation to `agent_name` or `session_id` |
| `POST /v0/city/{city}/extmsg/inbound` | Deliver a user turn |
| `GET /v0/city/{city}/extmsg/transcript` | Read replies with `after_sequence` + `limit` |
| `POST /v0/city/{city}/extmsg/transcript/ack` | Acknowledge consumption |

The real model is a **durable cursor over a transcript**, optionally combined
with a push `callback_url`, rather than a per-conversation SSE subscription.
For Factoru this is better: `ConversationTranscriptRecord.Sequence` is a
persistent cursor that survives restarts on both sides, which is precisely what
resumable conversation delivery needs. Binding to `agent_name` also survives
session restarts, cold-waking a session at delivery time.

The roadmap's description of the Project Manager transport is therefore updated
to match the running API.

### Named sessions are city-scoped, so rig-qualified PM chat is not available

The roadmap's open question — *can rig-qualified always-on Project Manager
sessions provide strict per-project chat isolation?* — is answered **no** for
1.4.0, on two independent observations:

- `[[named_session]]` rejects a `rig` field outright (`unknown field
  "named_session.rig"`), and a rig-qualified template name fails validation:
  `template "probe/factoru.project-manager-chat" must match
  [a-zA-Z0-9][a-zA-Z0-9_-]* or binding.agent`.
- `POST extmsg/bind` refuses to bind a conversation to a rig-scoped agent:
  *agent "probe/factoru.project-manager-chat" does not resolve to a configured
  named session; agent bindings require a named-session-backed agent*.

Together those mean a durable, restart-surviving conversation binding requires a
**city-scoped named session**. Per-project isolation must therefore come from
giving each project its own named-session-backed identity — Factoru generating a
distinct agent template plus `[[named_session]]` entry per project and reloading
the city — rather than from rig scoping. Milestone 3 must decide and record that
naming and lifecycle before Project Manager chat is built on it.

### The conversation round trip works, and the transcript cursor is exact

Registered an adapter, bound a conversation to a named-session-backed agent,
delivered a turn, and read the reply:

| Seq | Kind | Text |
| --- | --- | --- |
| 1 | `inbound` | "In one sentence, what does index.js export?" |
| 2 | `outbound` | "`index.js` exports three named arithmetic functions: `add`, `subtract`, and `multiply`." |

The reply carries `ReplyToMessageID: m1`, correlating it to the delivered turn.
`after_sequence` is strictly-greater-than: `after_sequence=1` returns only
sequence 2, and `after_sequence=2` returns an empty page. That is exactly the
durable cursor Factoru needs, and it is now exercised through the adapter
against the live supervisor.

Two API details worth pinning down, both encoded in the adapter:

- `ConversationKind` accepts only `dm`, `room`, or `thread`. A Project Manager
  conversation is a `dm`.
- `GET extmsg/transcript` requires every conversation field including `kind`.
  Omitting `kind` returns **500 Internal Server Error**, not a validation error,
  so a partially-built query looks like a server fault rather than a bad request.

### MCP projection is real, through the pack `mcp/` directory

The architecture recorded that Gas City "attachment-list MCP fields are not
materialized". That is true, but only of the **per-agent `mcp` arrays**, which
the pack spec calls compatibility tombstones ignored by active materialization.
The **pack-level `mcp/` directory** is scanned and projected.

Verified for both initial harnesses from one pack source, `stdio` transport,
`stage1` delivery:

| Harness | Projection target |
| --- | --- |
| Codex | `<workdir>/.codex/config.toml` |
| Claude | `<workdir>/.mcp.json` |

The file format is one TOML per server whose `name` must equal the filename
stem; the loader rejects a mismatch with
`name "" must match filename stem "factoru-probe"`.

`packs/factoru-default/assets/probe-tool/server.mjs` implements the probe: a
JSON-RPC 2.0 stdio MCP server that refuses to start without
`FACTORU_PROBE_TOKEN` and binds that token to one project and one role. It
exposes fixed development data and no product API, because designing Factoru's
most security-sensitive surface inside a throwaway probe would be exactly
backwards.

**But the pack `mcp/` directory does not deliver, and that is the trap.** A run
was slung asking the implementer to call `factoru_probe`. The agent reported:

> `factoru_probe` is not exposed in the tool set I can call.

No `.codex/config.toml` was written into the working directory at all — only
`hooks.json` and `skills/` appeared there.

So `gc mcp list` reports the **planned** projection for a target, not a
materialised one. The architecture's original concern was right, and more
precisely than it was stated: Gas City catalogs pack MCP configuration and
describes exactly where it would go, but does not attach it to a live session.
Reading `gc mcp list` output as proof that an agent has a tool would have been a
serious mistake, because it looks exactly like success.

### The bridge that does work: `session_setup_script`

Factoru installs its own tools instead, from a documented agent field whose
commands run after session creation. `assets/scripts/install-factoru-tools.sh`
writes both harness formats with an absolute server path and a freshly minted
per-session credential. Recorded as
[ADR 0010](../adr/0010-agent-tool-transport.md).

Both harnesses completed a real round trip:

| Harness | Role | Result |
| --- | --- | --- |
| Codex | `software-implementer` | Invoked `factoru_probe`; reported the bridge reachable |
| Claude | `software-reviewer` | Invoked `mcp__factoru-probe__factoru_probe`; returned the response verbatim |

Claude's returned payload:

```json
{
  "ok": true,
  "project_id": "probe",
  "role": "probe/factoru.software-reviewer",
  "session_credential_present": true,
  "note": "claude-bridge",
  "message": "Factoru probe tool reached. This is fixed development data, not project state."
}
```

Each session rewrote the config with its own role and a distinct random token,
so per-session scoping and credential rotation were observed rather than
assumed. The pack `mcp/` directory is deliberately absent from
`factoru-default`, so nothing in the pack suggests a delivery path that does not
run.

### Sessions run with unrestricted permissions by default

Live session options were `{"effort":"xhigh","model":"gpt-5.5",
"permission_mode":"unrestricted"}`. Factoru must set permission mode explicitly
when it applies Worker Type bindings rather than inheriting this default.

### Operational sequencing requirements

- `gc init` runs a **provider readiness preflight** and refuses to create a city
  when any declared provider is unauthenticated. Factoru must check readiness
  before provisioning, not after.
- Managed Dolt requires a global author identity (`dolt config --global` for
  `user.name` and `user.email`) or the city cannot start.
- `gc rig add` writes an import into `city.toml` that is not yet installed, so
  `gc reload` fails until `gc import install` runs. Registration is a
  three-step sequence: add, install, reload.
- Bead prefixes are derived from the rig name and collide on short prefixes
  (`probe` and `probe2` both derived `pr`). Factoru must supply an explicit
  prefix rather than relying on derivation.
- Importing `gascity/roles` for its prompt fragment also loads that pack's own
  agents into the city (+24 agents). A production Factoru pack should vendor
  only the fragment or accept the extra role definitions deliberately.

## Adapter review findings

The adapter was reviewed by Codex against this record. Confirmed findings, all
fixed, with the corrected behaviour covered by contract tests using recorded
1.4.0 response shapes:

1. **Event resume was silently broken.** `GET /events` has **no `after_seq`
   parameter** — only `/events/stream` does. The adapter sent it anyway, so the
   supervisor returned the newest page regardless of the cursor, and advancing
   to that page's highest sequence skipped everything older. Because a cursor
   only moves forward, those events were unrecoverable. `readEvents` now pages
   backwards from the head through `next_cursor` until it reaches the persisted
   sequence, with a bounded page count.
2. **Gap detection fired on ordinary pagination.** Mid-read, the oldest event
   seen is always newer than the cursor. It is now evaluated only once
   pagination is finished.
3. **Nullable arrays.** Every list in the 1.4.0 contract is
   `type: ["array","null"]`. A Zod `.default([])` only covers `undefined`, so an
   explicit `null` would have thrown.
4. **Wrong request-id header.** Gas City sends `X-GC-Request-Id`, not
   `X-Request-Id`. Verified against a live 503, which now carries
   `requestId: 9eda8db8e79042b7`.
5. **`describeRun` conflated identifiers.** It reused the run ID as the workflow
   root bead ID; the sling response reports them separately.
6. **`canceling` was mapped to terminal `cancelled`.** A requested cancellation
   is not a finished one, and treating it as terminal would let Factoru close a
   task whose agent is still running and still spending money. `blocked` and
   `skipped` were also missing.
7. **The compatibility range was justified by a check that did not exist.**
   `verifySupervisorContract` now reads the served OpenAPI and confirms every
   operation Factoru depends on is present; verified live against 1.4.0.
8. **Version parsing.** A bare digit in prose ("exited with code 3") parsed as
   `3.0.0`, and SemVer build metadata (`1.4.0+brew`) sorted below the plain
   release.

One finding was not confirmed: the reviewer expected `/rigs` to return
config-cased `Name`/`Path` fields. The served `RigResponse` schema and a live
response both use lower-snake, so the original schema was correct.

Two were accepted as accurate but deferred rather than fixed: the rig-safety
guard is a tested helper with no registration operation to enforce it until
Milestone 2, and `CityEvent` still carries Gas City's raw event vocabulary
because Milestone 1 has no product event taxonomy to map it onto. Both are now
stated as such rather than claimed as complete.

## Not yet verified

These remain open and must not be described as working:

- **Cancellation and partial failure.** `POST /runs/{id}/cancel` is mapped but
  never exercised.
- **Credential revocation mid-session.** A credential currently dies with its
  session. Revoking one while a session is live requires Factoru Server to
  reject it, which is why authentication must terminate there rather than at the
  MCP server.
- **Pack rollback.** Import and pin work; rolling back to a previous pinned
  commit was not tested.
- **Per-project named-session provisioning.** The constraint is understood; the
  generated-identity approach that works around it is not built.
- **Linux arm64 anything.** Raspberry Pi support remains unproven.

Partially verified:

- **Restart and event replay.** The supervisor was stopped and restarted, the
  city was re-adopted, and both the completed workflow and the event history
  remained readable afterwards; the adapter read 150 events across three pages
  from a persisted cursor. A Factoru-side restart was not exercised, because
  Factoru has no persistence to restart with until Milestone 2.

## What the gate left on the host machine

The spike is disposable, but some of it is machine-level and persistent. Anyone
reproducing this should know what to remove.

| Left behind | Where | Remove with |
| --- | --- | --- |
| Gas City and its dependency chain | Homebrew | `brew uninstall gascity` |
| Supervisor launchd service | `~/Library/LaunchAgents/com.gascity.supervisor.plist` | `gc supervisor uninstall` |
| Running supervisor | loopback `127.0.0.1:8372` | `gc supervisor stop` |
| Registered spike city | `~/.gc/cities.toml` | `gc unregister` from the city directory |
| Pack import cache | `~/.gc/cache/repos/` | `gc import prune` |
| Dolt author identity | `~/.dolt/config_global.json` | `dolt config --global --unset user.name user.email` |
| Spike city and disposable repositories | session scratchpad | delete the directory |

Two of these are worth calling out as product requirements rather than cleanup
notes. Gas City installs a **launchd agent** that starts the supervisor at
login, so Factoru Server's installer must own that lifecycle deliberately rather
than inherit it as a side effect of a first `gc start`. And managed Dolt
**refuses to initialise without a global author identity**, which is a
precondition Factoru's readiness check must cover — it is not something a user
will guess from a failed city start.

## Repository toolchain note

The gate surfaced an unrelated defect in the development environment: the
machine's default `pnpm` was `7.0.0-rc.9` while the repository declares
`pnpm@11.20.0`. The mismatched client rewrote `pnpm-lock.yaml` and dropped
vitest's platform binding, breaking every test in the workspace.

`package.json` now pins `node@22.13.0` and `pnpm@11.20.0` through Volta. Volta
1.1.1 manages pnpm only when `VOLTA_FEATURE_PNPM=1` is set in the shell.
