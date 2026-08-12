# 0018 — Server-owned managed project directories

**Status:** Accepted, implemented for new projects
**Date:** 2026-08-12

## Context

A project may contain several repositories and may later need project-level
instruction or policy files that do not belong to any one repository. The
previous onboarding path either operated directly in a selected local checkout
or cloned a remote URL into a shared approved repository root. That made the
project itself lack a stable filesystem boundary and allowed Gas City setup to
mutate a user's original checkout.

Factoru Server must remain usable as an unprivileged process. A literal
filesystem root such as `/factoru-projects` would normally require elevated
ownership and would make source-preview installation surprising.

## Decision

- The default managed root is `$HOME/factoru-projects`, configurable through
  the absolute `FACTORU_PROJECTS_ROOT` environment variable. Development
  worktrees use their isolated state directory instead; the source-preview CLI
  explicitly selects the home-directory default.
- Every new project receives a stable `<project-slug>-<project-id-prefix>`
  directory. Its repositories live under `repositories/`, leaving the project
  root available for later Factoru-owned instruction and metadata files.
- Remote repository URLs never choose a destination. Server derives a
  collision-resistant repository folder from the source name and URL hash and
  clones asynchronously after the project transaction commits.
- Selecting an existing repository treats it as an import source. It must be a
  completely clean, non-bare checkout under an approved import root. Server
  performs a local clone with no hard links into the project directory and Gas
  City operates only on that managed copy. The original source path is retained
  for diagnostics, not exposed to Desktop, and is not a credential source.
- Migration 0006 records the managed project directory and optional original
  import source. Existing projects are marked unmanaged and retain their
  recorded repository paths. Factoru does not move live repositories or rigs
  automatically.
- SQLite stores canonical absolute paths for server use. The protocol exposes
  only the managed project folder name, never the absolute host path.

## Consequences

- One project has a predictable server-side home regardless of how many Git
  hosts, SSH identities, or repositories it uses.
- Git, Gas City, and future project-level instructions operate on Factoru-owned
  project contents rather than a user's source checkout.
- Importing a dirty checkout is blocked because Git clone would omit uncommitted
  and untracked work. Users must commit, stash, or remove those changes first.
- Approved repository roots now authorize source discovery/import. They no
  longer determine where a remote repository is cloned.
- Existing projects remain safe and usable but do not gain a managed project
  directory until a separately designed migration flow exists.

## Revisit when

- project-level instruction files receive a schema, precedence, or sync policy;
- users need an explicit, recoverable migration of legacy projects;
- projects can add/remove repositories after creation; or
- packaged services require a non-home managed root and ownership migration.
