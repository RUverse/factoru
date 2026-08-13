# 0014 — Projects own one or more repository-backed rigs

**Status:** Accepted, partially implemented
**Date:** 2026-08-09

## Context

The original Milestone 2 slice made a Factoru project and repository
interchangeable: repository fields lived on `projects`, `project_rig_bindings`
used `project_id` as its primary key, and every downstream run implicitly used
that one rig. Real products often span a desktop, API, infrastructure, and
shared-library repository, while the Project Manager conversation, memory,
tasks, Workers, and capacity policy still belong to one product-level project.

Project creation also exposed approved-root traversal before the user could
name their project. Local macOS users expected a native folder chooser, and
remote users needed to provide a Git URL without granting the renderer general
filesystem or shell access.

## Decision

- A Factoru project is a named product aggregate containing an ordered,
  non-empty repository collection. Each repository owns one Gas City rig,
  default branch, source metadata, provisioning state, and error evidence.
- Exactly one repository is primary. The first repository selected during
  creation is primary; the existing serial task, PM, capsule, and run path keeps
  using that rig until task-to-rig routing is explicitly designed and tested.
- Forward migration 0005 creates `project_repositories`, backfills every legacy
  project/rig pair as its primary repository, and preserves the legacy primary
  columns as a compatibility projection for the proven execution path.
- `projects.create` persists the project, all desired repositories/rigs, the
  command receipt, event, and one outbox item per repository atomically. The
  reactor provisions each rig independently. A project is ready only when all
  repositories are ready, and setup retry requeues only failed repositories.
- HTTPS, SSH, and SCP-style SSH repository sources are cloned by Factoru Server
  into the project's server-owned managed directory. Existing local repositories
  are approved sources rather than execution locations; their clean committed
  state is cloned into the same managed directory. URLs containing credentials
  are rejected. Clone and rig-registration mutations occur after durable intent
  and are bounded/idempotent. Placement details are recorded in
  [ADR 0018](./0018-managed-project-directories.md).
- Desktop requests a bounded, non-interactive access check before staging a
  remote source, and `projects.create` repeats it before persisting any project,
  receipt, event, or outbox item. Setup retry repeats the check for failed remote
  sources before requeueing them. The later clone remains asynchronous so
  network work never enters the project transaction.
- Git authentication is owned by the unprivileged operating-system account that
  runs Factoru Server. Factoru honors its standard OpenSSH config, host aliases,
  known hosts, agent socket, and Git credential helpers. It does not import or
  persist private keys/tokens and never auto-accepts host keys. Multiple
  identities on one provider use normal SSH host aliases in repository URLs.
- Electron main owns the native macOS folder dialog. The selected absolute path
  goes directly to the server for canonical approved-root validation; the
  renderer receives only the bounded repository preview. Approved server-root
  browsing remains available for remote operation.
- The desktop creation surface asks for the project name first, stages multiple
  URL or folder sources, visibly marks the primary rig, supports removal before
  confirmation, and uses the full workspace area while creation is open.

## Consequences

- Project identity, conversation, memory, task ordering, Worker Types, and
  capacity remain shared across repositories instead of being duplicated into
  artificial per-repository projects.
- Rig readiness and retry are repository-specific, while project readiness is
  their aggregate. Canonical repository paths remain globally unique to one
  project.
- Native folder selection is convenient for a local server but does not imply
  that a folder on a remote desktop exists on the server. The server rejects
  selections outside its approved roots with an actionable error.
- Remote clone authentication remains server/operator configuration. Factoru
  checks and classifies access without collecting credentials in repository
  URLs, sending them through the renderer, or returning raw Git stderr.
- Additional rigs are durable project context now, but tasks do not yet choose
  or span them. Product copy must not imply cross-repository execution until
  task routing, Formula variables, capsules, evidence, and review all carry the
  selected rig set.

## Revisit when

- tasks need an explicit repository or multi-rig target;
- Project Manager planning can safely infer cross-repository changes;
- a project needs to add, remove, reorder, or change its primary repository
  after creation;
- packaged remote-server onboarding needs an explicit service-account
  credential lifecycle or clone progress/cancellation; or
- Gas City introduces a first-class multi-rig workflow primitive that changes
  the ownership boundary.
