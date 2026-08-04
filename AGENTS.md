# Factoru Repository Instructions

These instructions apply to the entire repository.

## Read first

- [docs/ROADMAP.md](./docs/ROADMAP.md) is the current product scope, architecture, and
  delivery order.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) is the living map of system boundaries,
  runtime flows, ownership, and implementation status.
- [docs/future/graph-orchestration.md](./docs/future/graph-orchestration.md)
  preserves a deferred design direction. It must not expand the MVP or override
  the roadmap.
- Prefer a small working vertical slice over speculative platform machinery.
- If implementation reveals that the roadmap is wrong, document the decision
  before silently changing a core boundary.

## Architecture synchronization requirement

- Keep `docs/ARCHITECTURE.md` accurate at all times. A code change that adds, removes,
  renames, bypasses, or materially changes a component, package boundary,
  protocol, persistence rule, trust boundary, deployment path, or source-of-truth
  owner must update the architecture file in the same change.
- The architecture file intentionally includes implemented and unimplemented
  parts. Preserve the status labels: `Implemented`, `Partial`, `Planned`,
  `Deferred`, and `Validate`.
- Mark something `Implemented` only when production code is connected to the real
  path and proportionately verified. Use `Partial` when scaffolding, mocks, or
  only one side of a boundary exists.
- When work completes, update the current implementation inventory, affected
  responsibility tables, diagrams, and flow descriptions. When plans change,
  update or remove the planned component instead of leaving stale architecture.
- Treat discrepancies between code and `docs/ARCHITECTURE.md` as defects. If a change
  cannot keep them aligned, stop and resolve the architecture decision first.
- Record consequential choices as ADRs and link them from the relevant
  architecture section. The architecture file remains the current summary even
  when an ADR contains the historical reasoning.

## Product invariants

- This is one monorepo containing two independently deployable applications:
  Factoru Desktop and Factoru Server.
- Desktop is an unprivileged client. Server owns persistent product state,
  secrets, repository access, agent execution, and orchestration.
- Gas City is a core server-side dependency accessed only through the narrow
  `packages/gas-city` adapter.
- Every agent runtime, including Project Manager chat, is managed through Gas
  City. Do not add a parallel provider/session runtime in Factoru Server.
- One Factoru Server initially manages one dedicated Gas City city; each
  repository-backed Factoru project maps to one rig. Factoru must coexist with
  unrelated cities hosted by the machine-level supervisor.
- The Gas City supervisor and all of its host-reachable cities form one trusted,
  single-operator runtime domain from the perspective of host-running agents.
  Rig prefixes provide logical routing and accidental-crossing protection, not
  adversarial project isolation. Keep supervisor/controller and Dolt listeners
  host-local and never proxy them through Factoru's remote API.
- T3 Code may be studied as a reference but is not an application dependency or
  fork unless a later explicit decision changes that.
- Projects, conversations, tasks, task dependencies, Worker Types, capacity
  policy, and durable project/role memory are Factoru entities.
- The active task statuses are exactly `backlog`, `queue`, `in_progress`, and
  `needs_you`. Do not add a `done` column; terminal tasks use a resolution and
  leave the active board.
- Backlog is a user-editable thought dump. Moving a card to Queue must trigger
  durable, idempotent Project Manager reconciliation; it does not immediately
  promise execution. Avoid requiring manual scheduling from Queue onward.
- Project Manager chat and planning use separate Gas City agent identities:
  chat is a rig-scoped always-on named session; planning is on demand and
  serialized to one pass per project. Group both as one visible Worker Type.
- Initial Worker Types are Project Manager and Software Engineer. Do not add a
  generalized worker-graph framework before the fixed workflow is proven.
- Software Engineer initially binds separate on-demand implementer and reviewer
  Gas City agents. The user may choose different implementation/review models;
  the formula coordinates them behind one Worker Type.
- A Formula defines routed steps, dependencies, and bounded control flow. It is
  not a Worker Type. A Worker Type composes agent/model bindings, prompt policy,
  Factoru tools, memory policy, formula selection, and capacity.
- Factoru has one progressively capable product experience, not separate simple
  and advanced modes. Start from curated Factory Templates and reveal Formula,
  bead, session, and capsule detail in the same interface as those controls
  become useful.
- Gas City-managed agents/sessions are Factoru's durable workers. A
  provider-native subagent may be used only as an implementation detail inside
  one bounded Formula step; it does not receive independent Factoru scheduling,
  capacity, memory, recovery, or Worker-Type identity.
- Initial autonomous execution has a WIP limit of one. Do not introduce
  parallel execution before the single-task milestone is dependable.
- Later `max_parallel_implementation_workers` is a project Factory ceiling. The
  Project Manager records logical dependencies/conflicts; Gas City determines
  bead readiness and concrete pool-session assignment. Never have the model
  manually name worker instances such as `SE 1`.
- The serial MVP must preserve the long-term product direction: automatic task
  orchestration, internal multi-agent review before user review, duplicate-task
  reconciliation, and full-stack worktree capsules for safe parallelism.
- One capsule belongs to one task run or independently scheduled Formula unit,
  never to an ephemeral agent session. Isolation is tiered: worktree-only,
  worktree plus containerized project services, and later a fully containerized
  worker when the security and compatibility cost is justified.
- Tier-one worktrees and tier-two service containers isolate resources and
  failures, not a malicious host-running agent. Only tier three may claim an
  agent security boundary, after network and filesystem isolation are proven.

## Intended package boundaries

```text
apps/desktop       Electron main, preload, and renderer
apps/server        API, authentication, application services, orchestration
packages/protocol  Versioned wire schemas and typed client contract
packages/domain    Framework-independent entities, value objects, and rules
packages/database  Server schema, migrations, and persistence adapters
packages/gas-city  Gas City integration behind Factoru-owned interfaces
packages/ui        Factoru visual primitives
packs/             Versioned Factoru Gas City agents, prompts, tools, checks, and formulas
templates/         Factoru Factory Template manifests that compose pinned packs with product defaults
```

- `packages/domain` must not import Electron, a UI framework, a database driver,
  or Gas City.
- `packages/protocol` must not import server-only or Electron-only modules. Treat
  every network input as untrusted and validate it at runtime.
- The renderer must not access Node.js, the filesystem, the database, provider
  credentials, or Gas City directly.
- Electron privileged capabilities must cross a narrow, typed preload API.
- Server application code depends on a Factoru-owned orchestration interface,
  not Gas City command or response shapes spread throughout the codebase.
- Gas City agents access Factoru state only through narrow authenticated,
  project- and role-scoped tools. They never open Factoru SQLite or receive
  general shell access to the server application.
- Those tools protect Factoru product state only; do not describe Gas City's
  host-local CLI/API/shared Dolt store as a per-project sandbox.
- Do not assume pack MCP declarations are automatically attached to Gas City
  sessions. Hide proven harness-specific MCP/hooks/bridge behavior behind the
  Gas City adapter. A real scoped tool round trip through both initial harnesses
  is a Milestone 1 exit gate, before prompts and Worker Types are treated as
  stable.
- Keep provider-specific model identifiers and options at adapter boundaries.

## Source-of-truth rules

- Factoru database owns project/task/conversation/Worker-Type/capacity and
  durable project/role memory state.
- Factoru owns cross-task dependency intent. A materialized run snapshots those
  relations into Gas City `needs` edges, after which Gas City owns that
  execution snapshot; do not independently edit both graphs.
- Gas City owns its city/rig/agent/session runtime plus materialized execution
  and dependency state.
- Git owns commits, branches, diffs, and worktree contents. The pinned
  Gas City integration spike decides lifecycle control; do not introduce a
  second worktree creator/cleaner beside the chosen owner.
- UI state derived from another owner may be cached, but it must be recoverable
  and must not become a second independently mutable truth.
- Every database schema change requires a forward migration and a migration
  test. Do not edit an already released migration.
- Persist state transitions transactionally and make externally retried commands
  idempotent where practical.

## Security and remote-operation rules

- Bind the server to localhost by default.
- Require authentication for non-local connections and authorization for every
  project-scoped operation.
- Never send provider or repository secrets to the renderer, logs, model
  prompts, or API responses.
- Do not expose arbitrary filesystem paths or arbitrary shell execution through
  a general-purpose renderer endpoint.
- Validate repository roots on the server before Git or filesystem operations.
- Prefer explicit command definitions from project configuration over shell
  strings generated by a model.
- Treat Factory Template manifests, city config, Formula v2 files, imported
  packs, pack commands, MCP configuration, and exec/session-provider scripts as
  trusted configuration or executable code; pin and review them and never
  assemble them from task text.
- Redact secrets from stored agent events and diagnostic bundles.

## Implementation discipline

- Work in the milestone order in `docs/ROADMAP.md` unless the user explicitly changes
  the priority.
- Keep changes small enough to review. A feature is incomplete without its
  failure, cancellation, restart, and empty-state behavior where relevant.
- Add tests at the narrowest useful layer. Important protocol and domain rules
  need unit tests; database behavior needs integration tests; critical user
  journeys need end-to-end coverage.
- For bug fixes, add a regression test when practical.
- Do not mock Gas City for the operational spike and then claim the integration
  works. Unit tests may use a fake adapter; milestone acceptance requires the
  real dependency.
- Bound every agent correction/retry loop and record why it stopped.
- Validate Formula v2 semantics above the pinned release: do not rely on inert
  `until`/gate vocabulary, unenforced variable types, or deprecated fan-out;
  cook and sling rig-scoped work in the rig store the target reads.
- Make model usage and cost observable from the first autonomous run.
- Preserve user worktrees and unrelated working-tree changes. Never use a
  destructive Git command as cleanup.

## UI guidance

- The project conversation is the primary direction surface; Backlog is the
  intentionally fast user-editable capture surface. Tasks and Workers explain
  and configure the system around them.
- Follow Factoru's own visual language. T3 Code is a behavioral reference, not a
  design to reproduce.
- Keep the four task columns legible without forcing horizontal management work.
- Show Queue planning phases as badges, not new columns, and keep PM chat
  responsive while reconciliation runs.
- Workers UI edits Factoru Worker Types/model slots and Factory capacity, not
  raw Gas City agent/session TOML or concrete pool identities.
- Do not create a mode switch for operational depth. Show concise defaults
  first, then progressively disclose the selected task's Formula run, beads,
  sessions, dependencies, evidence, and capsule resources in the same product
  surfaces.
- `needs_you` must state the exact requested action: clarify, approve, review,
  resolve a conflict, or recover from failure.
- Streaming and optimistic UI must reconcile with authoritative server events
  after reconnect.
- Accessibility, keyboard operation, reduced motion, and useful empty/error
  states are part of a finished UI change.

## Platform policy

- Desktop: macOS first; avoid unnecessary APIs that block later Linux support.
- Server: macOS arm64 and Linux arm64/x86_64 are early targets.
- Put OS-specific behavior behind explicit adapters and test capability
  detection. Do not infer support only from the OS name.
- Raspberry Pi support is unproven until Gas City and its dependency chain pass
  an end-to-end Linux arm64 test. Four cloud-model worker sessions on an 8 GB
  host are a benchmark target, not a guarantee; effective capacity must also
  account for builds, services, memory pressure, CPU, Dolt/backup growth,
  compaction headroom, storage I/O, and provider limits.

## Tooling and commands

The repository has not been scaffolded yet. Milestone 0 is the walking skeleton:
when it selects the toolchain, add the canonical install, development, lint,
typecheck, unit, integration, end-to-end, build, and packaging commands here.
CI and local commands should use the same entry points.

Until then, do not introduce multiple competing package managers or task
runners. The roadmap's intended default is pnpm workspaces.

## Documentation expectations

- Update `docs/ROADMAP.md` when product scope, milestone order, or a product invariant
  changes.
- Update `docs/ARCHITECTURE.md` in the same change as any implemented or planned
  architecture change, including status transitions from planned to partial or
  implemented.
- Record consequential technical choices as short ADRs under `docs/adr/` once
  that directory exists.
- Keep protocol and deployment documentation beside the code that implements
  it.
- Mark speculative ideas as later work instead of presenting them as existing
  capability.
