# 0006 — Per-worktree development state and derived ports

**Status:** Accepted (Milestone 0)
**Date:** 2026-08-04

## Context

Factoru intends to give users isolated task capsules. The roadmap is explicit
that the repository must do this for its own development state first: two Git
worktrees of this repository must never share a server data directory or a
development port, and the values must be stable so a developer can bookmark
them.

Without this, two worktrees would fight over one port and, worse, over one
server identity and database file.

## Decision

Everything is derived from the absolute worktree path — no allocation registry,
no coordination file.

- `worktreeId` is the first 12 hex characters of `sha256(worktreeRoot)`.
- **Data directory:** `<worktree>/.factoru-dev/<worktreeId>`, which is
  gitignored. Keeping state inside the worktree makes it collision-free by
  construction and means removing the worktree removes its state.
- **Ports:** a block of four consecutive ports — server, renderer dev server,
  inspect, and one reserved — derived from the worktree id inside
  `20000–40000`, below the ephemeral range and above common service ports.
- Because a hash-derived port is stable but not unique, `pnpm dev` probes the
  derived block and steps forward deterministically by whole blocks until it
  finds one that is free, printing a warning when it does. The claim is
  "collision-free at run time", not "hash collisions are impossible".
- `pnpm dev --only desktop` deliberately skips probing and attaches to the
  derived block, because a server is expected to be listening there.

The derivation lives in `scripts/worktree-env.mjs` and is covered by tests. The
applications themselves read plain environment variables
(`FACTORU_DATA_DIR`, `FACTORU_HOST`, `FACTORU_PORT`, `FACTORU_SERVER_URL`,
`FACTORU_RENDERER_PORT`, `FACTORU_LOG_LEVEL`) and fall back to production
defaults, so no application depends on the development harness.

`pnpm dev:env` prints the current worktree's values, with `--json` and
`--export` for other tooling.

## Consequences

- A server started in one worktree has its own identity file and, later, its own
  database; a second worktree cannot corrupt it.
- Development ports are predictable across restarts, so a bookmarked
  `http://127.0.0.1:<port>` keeps working.
- Deleting `.factoru-dev/` is a complete, safe reset of development state.

## Revisit when

- The four-port block is not enough — for example when Gas City development
  needs its own reserved local port in Milestone 1.
- Development state must outlive a worktree, which would require moving the data
  directory outside it and keeping the id as the collision guard.
