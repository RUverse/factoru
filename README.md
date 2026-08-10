# Factoru

A personal development team that runs on infrastructure you control.

**Factoru Server** runs on an always-on machine and owns projects, agents, and
durable state. **Factoru Desktop** is an unprivileged Electron client that
connects to it. See [docs/ROADMAP.md](./docs/ROADMAP.md) for the product and
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the living system map.

> **Status: Milestones 0–6 complete; Milestone 7 is next.** The development app
> connects durable projects and Project Manager chat to the four-state task
> board, serialized Queue reconciliation, one-at-a-time software delivery,
> independent review, and human acceptance. The real provider path completed
> ten benchmark tasks plus one conversation-originated task across a server
> restart. Packaging and dependable-operation work remain.

## Requirements

- Node.js 22.13.0 (pnpm downloads this project runtime automatically)
- pnpm 11.20.0 (pinned by `packageManager` and Volta in `package.json`)
- Gas City 1.4.x and its dependencies for project/chat/Queue/delivery testing
- At least one authenticated provider harness for agent-backed testing

## Getting started

```bash
pnpm install --frozen-lockfile
```

Volta users must enable its pnpm support before invoking the repository-pinned
package manager:

```bash
export VOLTA_FEATURE_PNPM=1
```

The root manifest also pins Node through pnpm's `devEngines.runtime`. Commands
such as `pnpm dev` therefore run under Node 22.13.0 even when the `pnpm`
executable itself was installed under another Node release. This keeps native
dependencies such as `better-sqlite3` on one ABI. Dependency installation and
the frozen lockfile remain explicit; pnpm's redundant pre-run reinstall check
is disabled so normal commands do not prompt to purge a current install.

Run both applications against this worktree's isolated development state:

```bash
pnpm dev
```

The server and the Electron window start together. Their URL and isolated state
directory are printed in the terminal. Same-machine development uses a private,
restart-scoped local enrollment proof and does not expose a pairing secret to
the renderer. Generate a pairing code only when explicitly testing the remote
or manual pairing path:

```bash
pnpm dev:pair
```

The first `pnpm dev` creates the development server identity. In another
terminal, explicitly initialize that identity's dedicated Gas City city with
the provider harnesses you want to test. Nothing is chosen silently:

```bash
pnpm dev:city --provider codex
```

Select several providers and one default when needed:

```bash
pnpm dev:city --provider claude --provider codex --default-provider codex
```

The command pins the local `factoru-default` pack, installs its imports, and
registers the city without automatically restarting a drifting machine-wide
supervisor. The selected harnesses must already be authenticated.

The development server is useful for protocol and persistence work before the
city exists, but project chat, Queue planning, and delivery require the
initialized city.

### Remote Linux preview over SSH

An experimental source-deployment runbook is available for 64-bit Linux arm64
and x64 hosts, including Raspberry Pi OS 64-bit as an explicitly unvalidated
target. It keeps Factoru, Gas City, and Dolt on loopback and connects Desktop
through a manual SSH local forward.

After installing the host prerequisites and cloning `dev`, validate the host:

```bash
pnpm install --frozen-lockfile
pnpm remote:preflight -- --provider codex
```

See [Remote Linux source deployment over SSH](./docs/remote-connection.md) for
the complete install, pairing, full-loop test, update, and recovery limitations.

Run the applications individually when needed:

```bash
pnpm dev:server
```

```bash
pnpm dev:desktop
```

`pnpm dev:desktop` expects a server already listening on this worktree's derived
port.

For project-creation testing, prefer a clean disposable Git repository because
Gas City rig registration intentionally creates Beads metadata and may commit it
in the selected repository. Point the development server at a containing folder
instead of this source worktree:

```bash
FACTORU_REPOSITORY_ROOTS='["/absolute/path/to/disposable-repositories"]' pnpm dev
```

After connecting, add the disposable repository, open Tasks, capture a Backlog
card, move it to Queue, and observe the planning phase badge. A ready task can
then enter the WIP-one delivery loop and finish in Needs you with its diff,
checks, independent review, risks, and model usage.

## Current limitations

- Development-from-source is the supported path; signed/notarized Desktop and
  packaged Server distributions arrive in Milestone 7.
- The serial execution limit is one. Parallel capsules and service-container
  isolation are deferred to Milestone 8.
- Remote access relies on an operator-controlled private HTTPS overlay or
  loopback reverse proxy, or the documented manual SSH developer-preview
  tunnel; packaged remote acceptance remains.
- Provider-backed acceptance is intentionally opt-in because it spends tokens
  and mutates a disposable repository.

## Per-worktree development state

Every Git worktree gets its own server data directory and its own block of
development ports, derived from the worktree path
([ADR 0006](./docs/adr/0006-per-worktree-development-state.md)). Two worktrees
never share a port or a server identity.

```bash
pnpm dev:env
```

State lives in `.factoru-dev/` inside the worktree and is gitignored; deleting
that directory is a complete reset.

## Checks

The same commands run locally and in CI.

```bash
pnpm check
```

That runs, individually available as:

| Command             | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `pnpm build`        | Compile every package and application                         |
| `pnpm typecheck`    | Build, then typecheck every package                           |
| `pnpm lint`         | ESLint, including the package-boundary rules from `AGENTS.md` |
| `pnpm format:check` | Prettier (`pnpm format` rewrites)                             |
| `pnpm test`         | Vitest per package plus the development-script tests          |

The destructive, provider-backed acceptance harness is not part of
`pnpm test`. Its latest 10/10 benchmark and conversation-originated run are
recorded in
[`docs/spikes/milestones-5-6-acceptance.md`](./docs/spikes/milestones-5-6-acceptance.md).
See [`docs/TESTING.md`](./docs/TESTING.md) for the deterministic, interactive,
restart-recovery, and opt-in provider-backed test procedures.

## Repository layout

```text
apps/desktop       Electron main, preload, and renderer
apps/server        API, application services, orchestration
packages/protocol  Versioned wire schemas, compatibility rules, typed client
packages/domain    Framework-independent entities, value objects, and rules
packages/database  SQLite migrations and persistence adapters
packages/gas-city  Factoru-owned Gas City integration
packages/config    Shared TypeScript configuration
scripts/           Development harness and per-worktree environment
docs/              Roadmap, architecture, and decision records
```

`packages/ui` provides the visual tokens used by the renderer. `templates/`
contains the built-in Software Project Factory Template, and
`packs/factoru-default` contains the versioned Project Manager and Software
Engineer roles plus the production Queue-reconciliation and software-delivery
formulas.

## Working in this repository

Read [AGENTS.md](./AGENTS.md) first. It defines the product invariants, package
boundaries, source-of-truth rules, and the requirement to keep
`docs/ARCHITECTURE.md` accurate in the same change as the code.
