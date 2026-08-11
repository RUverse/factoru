# Factoru development and testing

This guide covers the development-from-source path through Milestone 6. The
packaged installation and recovery matrix belongs to Milestone 7.

## 1. Verify the toolchain

The repository pins Node.js 22.13.0 and pnpm 11.20.0 in `package.json`. pnpm's
`devEngines.runtime` downloads and selects the pinned Node runtime for project
scripts, so the Node version that launched pnpm may differ safely.

```bash
pnpm exec node --version
pnpm --version
```

Volta users must enable pnpm support before invoking the repository-pinned
version:

```bash
export VOLTA_FEATURE_PNPM=1
```

Expected versions:

```text
v22.13.0
11.20.0
```

If pnpm reports a runtime download or lockfile error, do not use `--force` or
rebuild native dependencies under a different Node major. Install with the
pinned toolchain:

```bash
pnpm install --frozen-lockfile
```

Agent-backed testing additionally requires Gas City 1.4.x, Git, tmux, jq, Dolt
2.1.0 or newer, Beads (`bd`), `flock`, and at least one authenticated provider
harness.

```bash
gc version
git --version
tmux -V
jq --version
dolt version
bd version
flock --version
```

## 2. Run the deterministic verification gate

Run the same aggregate command used by CI before interactive testing:

```bash
pnpm check
```

It runs formatting, production builds, TypeScript checks, ESLint package
boundaries, Vitest suites, real-listener Server integration tests, database
migration/recovery tests, and development-script tests. It does not call a model
provider or run the destructive acceptance benchmark.

The checks are also individually available:

```bash
pnpm format:check
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Use a workspace filter for a focused watch loop:

```bash
pnpm --filter @factoru/server test:watch
pnpm --filter @factoru/desktop test:watch
pnpm --filter @factoru/database test:watch
pnpm --filter @factoru/gas-city test:watch
```

The Server end-to-end tests bind temporary loopback ports. A restricted
container or sandbox must allow local listeners for those tests.

## 3. Smoke-test Server and Desktop

Inspect the isolated state and derived ports for the current Git worktree:

```bash
pnpm dev:env
```

Start both applications:

```bash
pnpm dev
```

Or start them separately:

```bash
pnpm dev:server
pnpm dev:desktop
```

The server health endpoint is printed by the harness and is available below the
versioned API prefix. For example:

```bash
curl http://127.0.0.1:32800/api/v1/health
```

Replace `32800` with the server port printed for the current worktree.

Check that the response reports `status: "ok"`, the expected protocol version,
a stable `serverId`, storage figures, and the current capabilities. Stop and
restart the server and confirm that `serverId` remains unchanged.

Same-machine Desktop development uses private local enrollment. Use
`pnpm dev:pair` only when explicitly exercising remote/manual pairing. Verify
that the Desktop connects, shows the same server identity, and recovers its
cached workspace after a Desktop restart.

## 4. Initialize the development city

The development server must create its stable identity before the city can be
initialized. For a fresh worktree:

1. Run `pnpm dev` and wait for the Server to listen.
2. Stop it after the identity file is created.
3. Initialize the city with an already-authenticated harness.
4. Start `pnpm dev` again for interactive testing.

One provider:

```bash
pnpm dev:city --provider codex
```

Several providers with an explicit default:

```bash
pnpm dev:city \
  --provider claude \
  --provider codex \
  --default-provider codex
```

The command creates or adopts only this worktree's Factoru city, pins the local
`factoru-default` pack, installs imports, and starts it without automatically
restarting a drifting machine-wide supervisor.

## 5. Exercise the complete product path

Use a clean disposable Git repository. Rig registration creates reviewed Gas
City/Beads metadata and may create a commit, so do not select the Factoru source
repository or a repository containing uncommitted user work.

Expose only a containing directory of disposable repositories:

```bash
FACTORU_REPOSITORY_ROOTS='["/absolute/path/to/disposable-repositories"]' pnpm dev
```

Verify the connected Milestone 6 path:

1. Connect Desktop and confirm server and Gas City health.
2. Add a clean repository-backed project and inspect the disclosed registration
   changes.
3. Send a Project Manager message, receive a provider reply, and confirm the
   conversation survives Desktop and Server restarts.
4. Edit Worker model slots and confirm the desired binding becomes healthy.
5. Create and edit a rough Backlog card.
6. Move the card to Queue and observe `awaiting_triage`, `triaging`, and the
   resulting ready/waiting/clarification phase.
7. Confirm duplicate candidates and ambiguous merges require an explicit user
   decision.
8. Let one ready task enter In progress under the WIP-one limit.
9. Inspect Formula stage, implementation/review steps, logs, deterministic
   checks, token usage, and explicit priced/unpriced state.
10. Confirm completion enters Needs you with the request, plan, diff, commits,
    checks, independent review, unresolved risks, and usage.
11. Exercise cancel, retry, request changes, approve, and archive on appropriate
    disposable runs.

During a disposable run, restart Desktop and then Factoru Server independently.
Confirm that accepted intent, task/run correlation, cursors, the capsule, and
the final review package recover without duplicate work. Do not restart a
shared machine-wide Gas City supervisor merely for routine testing because it
may host unrelated cities.

Regression tests cover duplicate delivery, replay, transient dispatch failure,
bounded retry/exhaustion, dirty capsules, conflicts, cancellation, malformed
Formula inputs, migration rollback, and invalid authentication. Prefer those
deterministic tests unless a milestone explicitly requires another destructive
operator drill.

## 6. Run the provider-backed acceptance benchmark

`scripts/milestone-5-acceptance.mjs` is deliberately excluded from
`pnpm test`. It spends provider tokens, runs ten delivery tasks plus one
conversation-originated path, and mutates the explicitly supplied disposable
repository. Run it only against a dedicated city and repository that may be
discarded.

Build first:

```bash
pnpm build
```

Then supply existing absolute directories and the city name:

```bash
FACTORU_ACCEPTANCE_ROOT=/absolute/path/to/acceptance-state \
FACTORU_ACCEPTANCE_REPO=/absolute/path/to/disposable-repository \
FACTORU_GAS_CITY_PATH=/absolute/path/to/factoru-city \
FACTORU_GAS_CITY_NAME=factoru-0123456789ab \
node scripts/milestone-5-acceptance.mjs --run
```

`pnpm dev:env` prints the worktree data directory; its city is stored below
that directory as `gas-city`. The development city name is `factoru-` followed
by the first twelve hexadecimal characters after `srv_` in that worktree's
`server-id` file; replace `0123456789ab` above with those characters.

The harness writes `milestone-5-report.json` in the acceptance root. Compare
its acceptance rate, run durations, token usage, pricing completeness,
repository cleanliness, restart evidence, checks, and review findings with
[`spikes/milestones-5-6-acceptance.md`](./spikes/milestones-5-6-acceptance.md).

## 7. Reset development state deliberately

Each worktree's ignored `.factoru-dev/` directory owns its development server
identity, database, city, ports, and runtime state. Removing it is a complete
reset, not a cache cleanup. Stop Factoru and inspect the exact worktree-local
directory printed by `pnpm dev:env` before discarding it. Never remove a shared
Gas City supervisor or unrelated city as part of a Factoru reset.
