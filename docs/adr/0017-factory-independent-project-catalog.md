# 0017 — Factory-independent Desktop project catalog

**Status:** Accepted
**Date:** 2026-08-11

## Context

Desktop maintains one authenticated session and cache per Factoru Server, but ADR
0016 initially made one selected server control both the visible projects and every
command. That forced users to switch infrastructure before they could find a
project and made the factory control look like project navigation.

Projects remain server-owned: their repositories, history, workers, credentials,
and orchestration cannot become authoritative Desktop preferences. Desktop still
needs one coherent catalog when local and remote factories are connected together.

## Decision

- Electron main aggregates the cached projects from every saved factory into one
  Desktop projection. Each entry has a compound `{ factoryId, projectId }`
  reference; server-local project IDs are never assumed to be globally unique.
- Each project has exactly one authoritative **home factory** in the current
  product. Every project-scoped Desktop command carries the compound reference and
  routes directly to that factory, independent of presentation filters.
- The open project is persisted separately from factory filtering. Selecting a
  factory filters the project list and supplies the default home factory during
  project creation; it does not replace the open workspace or disconnect sessions.
- The factory control reports aggregate connection health and manages individual
  profiles. Friendly names and the current filter remain Desktop-local
  presentation state.
- Offline factories retain recoverable cached project entries. Their open
  workspaces are read-only until the owning session reconnects.
- A future project may attach additional execution factories, but its home factory
  remains the single product-state owner. Server-to-server trust, repository
  mappings, task placement, and recovery must be designed before that capability
  is implemented; project databases will not be replicated between factories.

## Consequences

- ADR 0016 remains authoritative for concurrent per-profile connections, but its
  selected-server workspace and command-routing decision is superseded here.
- The Factoru Server protocol and database do not change. The home-factory
  association is the Desktop profile from which the server-owned project was read.
- Electron's preload API becomes more explicit: repository, device, project, task,
  and run operations identify their target factory or compound project reference.
- Forgetting a remote profile removes its cached catalog entries and credentials
  from that Desktop only; the owning server data is untouched.

## Revisit when

The later multi-factory execution design has proven server-to-server authorization,
per-factory repository mappings, task placement, health, cancellation, and
recovery without introducing a second owner for project history.
