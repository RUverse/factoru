# Factoru

A personal development team that runs on infrastructure you control.

**Factoru Server** runs on an always-on machine and owns projects, agents, and
durable state. **Factoru Desktop** is an unprivileged Electron client that
connects to it. See [docs/ROADMAP.md](./docs/ROADMAP.md) for the product and
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the living system map.

> **Status: Milestones 0–4 implemented.** The development app includes durable
> projects, persistent Project Manager chat, Worker/model/memory controls, the
> four-state task board, and serialized Queue reconciliation. Provider-backed
> operator acceptance, remote HTTPS, and the Milestone 5 delivery loop remain.

## Requirements

- Node.js 22.12 or newer
- pnpm 11 (`corepack enable pnpm`, or install it however you manage Node tools)
- Gas City 1.4.x and its dependencies for project/chat/Queue testing

## Getting started

```bash
pnpm install
```

Run both applications against this worktree's isolated development state:

```bash
pnpm dev
```

The server and the Electron window start together. Its URL and isolated state
directory are printed in the terminal. Generate a pairing code in another
terminal with:

```bash
pnpm dev:pair
```

Enter the printed development server URL and pairing code in the desktop.
Individually:

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

After pairing, add the disposable repository, open Tasks, capture a Backlog
card, move it to Queue, and observe the planning phase badge. Queue planning and
Project Manager chat additionally require the dedicated Gas City city and chosen
provider harness to be configured and authenticated.

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
Engineer roles plus the production Queue reconciliation Formula.

## Working in this repository

Read [AGENTS.md](./AGENTS.md) first. It defines the product invariants, package
boundaries, source-of-truth rules, and the requirement to keep
`docs/ARCHITECTURE.md` accurate in the same change as the code.
