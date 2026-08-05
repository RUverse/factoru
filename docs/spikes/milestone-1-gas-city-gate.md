# Milestone 1 — Gas City feasibility gate

> Status: in progress
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

- Factoru probe tool round trip through both harnesses.
- PM chat named session through `extmsg` driven by Factoru Server.
- Restart and event replay across a supervisor and Factoru restart.
- Cancellation and partial failure.
- Pack rollback.
- Linux arm64 anything. Raspberry Pi support remains unproven.

## Repository toolchain note

The gate surfaced an unrelated defect in the development environment: the
machine's default `pnpm` was `7.0.0-rc.9` while the repository declares
`pnpm@11.20.0`. The mismatched client rewrote `pnpm-lock.yaml` and dropped
vitest's platform binding, breaking every test in the workspace.

`package.json` now pins `node@22.13.0` and `pnpm@11.20.0` through Volta. Volta
1.1.1 manages pnpm only when `VOLTA_FEATURE_PNPM=1` is set in the shell.
