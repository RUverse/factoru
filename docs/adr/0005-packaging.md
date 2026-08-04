# 0005 — Packaging and distribution

**Status:** Accepted as the direction; implemented in Milestone 7
**Date:** 2026-08-04

## Context

Factoru ships two artifacts from one repository: a macOS-first Electron desktop
and an always-on server for macOS arm64 and Linux arm64/x86_64. The server must
be installable both as a user-managed local process ("Run on this device") and
as a service or container on a separate machine. The decision is recorded now so
that Milestone 0's build layout does not have to be redone later.

## Decision

**Factoru Desktop: electron-vite for building, electron-builder for packaging.**

- electron-vite produces the three trust-level bundles (main, preload, renderer)
  and is already the Milestone 0 build.
- Shared workspace packages are declared as devDependencies of `apps/desktop`
  and bundled into the output, because electron-vite externalizes anything in
  `dependencies`. A packaged application therefore contains no reference to the
  monorepo layout.
- Milestone 7 adds electron-builder with a signed and notarized macOS build.
  Linux desktop packaging stays a later item, so no Linux-only Electron APIs may
  be introduced in the meantime.
- Electron 43 no longer installs its runtime through a lifecycle script, so
  `apps/desktop` runs `install-electron` from its `dev`/`start` scripts. The
  download is skipped when the runtime is already present, which also keeps CI
  from downloading Electron for lint, typecheck, test, and build.

**Factoru Server: a bundled Node service plus a container image.**

- The primary artifact is the compiled `apps/server` output run by a pinned
  Node 22 runtime, packaged per platform because of the native SQLite module
  ([ADR 0004](./0004-database-and-migrations.md)).
- A container image is published for the remote topology. It is the same
  application, not a different backend.
- The server does **not** bundle Gas City. Gas City and its runtime dependencies
  are host prerequisites with a pinned tested compatibility range, validated by
  the readiness checks introduced in Milestone 1.
- How a local server is launched (login service, desktop-managed child process,
  or container) remains **Validate** and is decided with the local-server
  lifecycle spike.

## Consequences

- The desktop build must keep shared packages out of `dependencies`, which is
  documented in `apps/desktop/electron.vite.config.ts`.
- Server releases are per platform, and CI must build on macOS and Linux.
- Packaging cannot begin before the database driver is chosen, which it now is.

## Revisit when

- The native SQLite dependency disappears, which would allow a single portable
  server artifact.
- Linux desktop distribution is scheduled, or a code-signing requirement changes.
