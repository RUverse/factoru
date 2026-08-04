# 0004 — Database library and migrations

**Status:** Accepted as the direction; not yet implemented (lands in Milestone 2)
**Date:** 2026-08-04

## Context

Milestone 0 must record the database and migration decision even though no
schema exists yet, so that Milestone 2 starts from a decision rather than a
debate. `docs/ARCHITECTURE.md` requires SQLite in WAL mode, foreign keys, short
serialized write transactions, forward-only migrations with migration tests,
online backups, and a driver that packages cleanly on macOS arm64 and Linux
arm64/x86_64.

Only Factoru Server opens the database file. The desktop never does.

## Decision

**Driver: `better-sqlite3`.** It is synchronous, which suits the transactional
state-plus-event model: a command handler opens a short transaction, writes
state, appends events and the command receipt, enqueues outbox work, and commits
without ever awaiting a model, Gas City, Git, or the network inside the
transaction. Synchronous access removes a whole class of interleaving bugs that
an async driver invites here.

`node:sqlite` was rejected for now: it is attractive because it removes a native
dependency, but its API is still moving and Factoru wants one pinned behavior
across three target platforms. The persistence adapter in `packages/database`
keeps the driver replaceable, so revisiting this is a contained change.

**Migrations: hand-written forward-only SQL files with a small runner** in
`packages/database`, applied inside a transaction and recorded in a `migrations`
table. No ORM-owned migration generator.

- Migrations are numbered, forward-only, and never edited once released.
- Every migration ships with a migration test that creates a database, applies
  the sequence, and asserts the resulting schema and any data transformation.
- The runner refuses to start when the database is newer than the binary,
  because a downgraded server must not silently operate on a future schema.

**Query layer:** typed repository functions over explicit SQL. Not an ORM. The
schema is small, the queries must match real UI access patterns and cursor
pagination, and explicit SQL keeps index behavior visible.

**Connection policy:** WAL mode, `foreign_keys = ON`, a configured busy timeout,
one writer path, and explicit checkpoint and free-space monitoring. Large logs,
diffs, and artifacts are stored outside rows with durable metadata.

## Consequences

- The server carries a native module. Packaging must rebuild or prebuild it per
  target platform ([ADR 0005](./0005-packaging.md)), and CI must cover macOS and
  Linux.
- Migration authoring is manual, which is the intent: schema changes to durable
  product state should be deliberate.
- Because the driver is synchronous, long-running work must never be executed
  inside a transaction. That rule is already stated in `docs/ARCHITECTURE.md`.

## Revisit when

- Milestone 2 finds that `better-sqlite3` cannot be packaged acceptably for
  Linux arm64, or that `node:sqlite` has stabilized enough to remove the native
  dependency.
- Concurrent read load makes a synchronous driver a measured bottleneck.
