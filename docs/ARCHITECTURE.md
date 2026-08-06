# Factoru Architecture

> Document type: living implementation map
> Last reviewed: 2026-08-06
> Runtime implementation status: Milestones 3 and 4 application slices
> implemented; operator acceptance remains

This document describes both the architecture Factoru intends to build and the
parts that actually exist. It must change with the code. Product scope and
delivery order live in [ROADMAP.md](./ROADMAP.md); the deferred graph vision
lives in [future/graph-orchestration.md](./future/graph-orchestration.md).

## Status legend

Every architectural component and major capability uses one of these labels:

| Label | Meaning |
| --- | --- |
| **Implemented** | Production code exists, is connected to the real system, and has proportionate verification. |
| **Partial** | Some production code exists, but the described boundary or behavior is incomplete. |
| **Planned** | Accepted architecture for a roadmap milestone, but no production implementation exists. |
| **Deferred** | Product direction intentionally outside the current milestones. |
| **Validate** | A spike or decision is required before this can become the accepted architecture. |

Do not interpret a diagram as proof that a component exists. The implementation
inventory below is authoritative.

## Current implementation inventory

| Area | Status | Current reality | Next proof |
| --- | --- | --- | --- |
| Monorepo | **Implemented** | pnpm workspace with both applications, protocol/domain/config/database/Gas City/UI packages, versioned templates and pack sources, scripts, boundary linting, shared builds/tests, Linux/macOS CI, isolated per-worktree state/ports/pairing, an explicit provider-selected development-city bootstrap, plus a disposable-repository-root override for safe project acceptance. | Add only milestone-owned boundaries as their real paths connect. |
| Factoru Server | **Partial** | Fastify connects SQLite-backed pairing, trusted devices, authenticated one-time WebSocket tickets, scoped live methods, durable projects/workspaces/tasks, idempotent product commands, event/outbox reactors, Project Manager conversation delivery, production Queue reconciliation, and restart observation while remaining loopback-bound. Direct task commands, explicit merge decisions, and the internal agent-tool gateway are connected; remote proxy and full operator acceptance remain. | Exercise one provider-driven reconciliation and then add the Milestone 5 delivery loop. |
| Shared protocol | **Implemented** | `packages/protocol` owns runtime-validated health/handshake, pairing, ticket, project/repository/device/workspace/conversation/Worker-Type/task/Queue-phase/merge-decision, live request/response/event, cursor snapshot, compatibility, and typed HTTP client schemas. Older cached workspaces receive safe empty task and merge-proposal defaults. | Extend the contract only with Milestone 5 execution evidence. |
| Factoru Desktop | **Partial** | Electron main persists server-ID-bound profiles, OS-encrypted credentials, projects, selected workspace, conversations, Workers, tasks, and cursors; owns the authenticated live connection; and exposes named IPC. The renderer provides the three-pane Factoru shell, persistent PM chat, Worker/model/memory controls, a responsive four-state board with direct capture/edit/move/resolve, Queue phases, exact Needs-you requests, merge confirmation, planner status/cancellation, onboarding, and offline cache. | Complete user acceptance in development; managed launch and packaged Mac acceptance remain later milestones. |
| Gas City adapter | **Partial** | `packages/gas-city` is verified against Gas City 1.4.0: compatibility/readiness, loopback supervisor client, durable event and external-message cursors, guarded rig registration, run dispatch/observation/cancellation, and an idempotent project-runtime configurator for city-local chat identities plus rig-scoped provider/model patches. The production Queue reactor dispatches and adopts runs through this port. Raw DTOs and provider option fields stay inside the package. | Complete provider-backed Queue and restart acceptance, then add the Milestone 5 delivery path. |
| Agent-tool bridge | **Implemented** | Factoru installs both harness MCP configs from `session_setup_script`. Setup requests a short-lived credential from a loopback-only bootstrap, bound by the server to the exact rig, project, role, and Gas City session; the model never supplies it as an argument. The bridge exposes structured task tools, while server policy enforces role/project scope, request replay, and a redacted audit record ([ADR 0010](./adr/0010-agent-tool-transport.md)). | Exercise the production tools through both live provider harnesses during operator acceptance. |
| Factoru Gas City pack | **Partial** | `packs/factoru-default` 0.2.1 defines four provider-neutral agent roles, the earlier probes, the bounded production `queue-reconcile` Formula v2, and the role-scoped MCP bridge. Queue planning routes to the separate serialized planner identity; every concrete provider/model comes from Factoru Worker Type bindings or the city's explicit default. | Complete one live Queue reconciliation through provider, tools, and terminal workflow observation. |
| Factoru database | **Implemented** | `@factoru/database` uses `better-sqlite3`, WAL/foreign keys/busy handling, forward-only SQL migrations, server identity binding, explicit repositories, transactional generic command receipts/events/outbox, checkpoint, and online backup. Migration 0003 adds task/dependency/event/run, Queue reconciliation, merge-proposal, agent-credential/audit, Queue revision, and WIP-one records. Its task adapter coalesces bursts while allowing one pending follow-up behind a running planning pass, and enforces one active execution. | Add only the Milestone 5 execution records not already represented by task-run correlation. |
| Authentication and pairing | **Partial** | Hashed one-time pairing codes, hashed revocable owner tokens, method scopes, 60-second one-time connection tickets, rate limiting, active-socket revocation, and OS-encrypted desktop storage are connected and tested. | Validate the HTTPS proxy path on another machine. |
| Projects | **Partial** | Approved-root browsing, canonical-path uniqueness, branch/index preview fingerprints, durable async setup, rig binding, bounded retry, cursor events, cached desktop projection, and restart reopen exist. The real registrar uses the guarded `gc rig add` sequence. | Provision and recover one real project rig across every involved restart. |
| Project Manager chat | **Partial** | Every project receives one deterministic conversation and city-local Gas City chat identity. Authenticated desktop sends are persisted before a bounded delivery outbox, transcript replies resume by Gas City sequence, status/errors publish to cached clients, and a separate serialized planner probe can run/cancel without blocking chat. The generated configuration resolves under Gas City 1.4.0; packaged operator acceptance remains. | Complete one persistent live provider conversation through the packaged desktop and restart every process. |
| Four-state tasks | **Implemented** | The domain and protocol admit exactly `backlog`, `queue`, `in_progress`, and `needs_you`; SQLite persists active tasks, terminal resolutions, exact Needs-you actions, dependencies, history, run correlations, simple duplicate scores, WIP one, and coalesced Queue intent. Authenticated idempotent direct and PM tool commands are connected. The responsive desktop board supports Backlog capture/editing, Queue movement and phase badges, exact Needs-you requests, terminal resolution, and explicit merge decisions. Queue work dispatches with an idempotency key to one serialized Formula and is observed to terminal state. | Exercise the connected provider path during operator acceptance. |
| Worker types | **Implemented** | The built-in `software-project` Factory Template persists fixed Project Manager/Software Engineer contracts, named model slots, role-scoped task tool policies, Formula binding points, provenance-required versioned memory, and serial capacity. Authenticated Desktop edits project through the server into validated Gas City provider plus `option_defaults.model` bindings. | Exercise the production bindings and tools with live provider sessions. |
| Internal review | **Planned** | Fixed bounded workflow is documented only. | One implementation passes checks and internal review. |
| Human review | **Planned** | Needs-you semantics are documented only. | Review a real diff with evidence and choose an outcome. |
| Task-run capsule | **Planned** | One worktree-level capsule per task run is accepted for the single-task loop; no implementation exists. | Correlate one real Formula run, Gas City worktree, implementer, and reviewer to one capsule identity. |
| Service-container isolation | **Deferred** | Tier-two task-specific project services are defined but not scheduled before concurrency. | Run two capsules with distinct Compose, port, and database identities under resource limits. |
| Full-worker container | **Deferred** | Optional tier three, not the default or one container per session. | Prove provider hooks, credentials, caches, tools, ownership, and security on Linux. |
| Parallel orchestration | **Deferred** | The initial WIP limit is one. | Run two isolated tasks without increasing user effort. |
| Custom formulas | **Deferred** | Formula registry compatibility is a design constraint. | Define import, validation, trust, and versioning contract. |
| Graph Studio | **Deferred** | Described only in the future graph-orchestration note. | Revalidate after real formula and node usage exists. |

## Immediate implementation sequence

The opening architecture work is ordered to retire the largest risk before
durable product abstractions accumulate:

1. **Milestone 0 — Walking skeleton (complete):** the monorepo, versioned
   Desktop/Server handshake, shared verification commands, and isolated
   per-worktree development state exist. The desktop displays a local server's
   health and version through shared runtime-validated protocol types, and the
   same checks run locally and in CI.
2. **Milestone 1 — Gas City feasibility gate:** use disposable state to prove
   the pinned runtime, adapter transports, city/rig/session/bead/Formula event
   flow, both initial harness tool bridges, restart behavior, and one
   implement/review workflow.
3. **Milestone 2 — Persistence, projects, and remote connection:** introduce
   SQLite, identity, pairing, remote profiles, project ownership, rig bindings,
   and cursor-based recovery only after the dependency gate passes.

Milestone 1 deliberately does not define production tasks, Worker Types,
Factory Template persistence, or capsule management. Its probe IDs and data are
development fixtures. If it fails, the adapter or dependency decision changes
without requiring a migration of Factoru's product model.

## Architectural drivers

1. **Remote-first execution.** The code, credentials, agents, and durable state
   may live on an always-on machine different from the desktop.
2. **Conversation-first control with manual capture.** Chat is the main control
   surface, while Backlog is a deliberately low-friction user-editable thought
   dump. Moving a thought to Queue asks the Project Manager to turn it into
   schedulable work.
3. **Durable autonomous work.** Desktop disconnects, server restarts, and agent
   failures must not erase accepted commands or completed work.
4. **One owner per mutable fact.** Factoru, Gas City, Git, and the operating
   system must not each maintain competing authoritative state.
5. **Typed and versioned boundaries.** Desktop and server may update at
   different times, so compatibility must be explicit.
6. **Isolation before concurrency.** Parallel work is enabled only after
   worktrees and runtime resources have deterministic ownership and cleanup.
7. **Human attention is constrained.** More workers are not useful if Needs you
   becomes a larger, noisier queue.
8. **Gas City primitives stay visible at the integration boundary.** Factoru
   adapts cities, rigs, agents, sessions, beads, formulas, packs, convoys, and
   events instead of rebuilding a second orchestration engine.
9. **One progressively capable experience.** Factoru presents an opinionated,
   formula-native UX with curated defaults. Formula, bead, session, and capsule
   detail is disclosed in the same project/task surfaces over time, not through
   separate simple and advanced product modes.

## System context

All components in this diagram are **Planned** unless the implementation
inventory says otherwise.

```mermaid
flowchart LR
    U["User"]
    D["Factoru Desktop<br/>Electron client"]
    S["Factoru Server<br/>trusted execution boundary"]
    DB[("Factoru SQLite database")]
    SEC["Server secret store"]
    TOOLS["Factoru agent-tool gateway<br/>project-scoped commands"]
    GCA["Gas City adapter"]
    GC["Gas City supervisor<br/>machine-level control plane"]
    CITY["Factoru-managed city<br/>root pack + deployment config"]
    RIG["Project rig"]
    PM["PM chat<br/>always-on named session"]
    PLAN["PM planner<br/>on-demand serialized agent"]
    WORKERS["Implementer and reviewer<br/>on-demand pools"]
    GDB[("Gas City data<br/>beads and Dolt")]
    P["LLM and agent providers"]
    FS["Repositories, Git, worktrees,<br/>processes and artifacts"]

    U <--> D
    D <-->|"Authenticated, versioned API"| S
    S <--> DB
    S <--> SEC
    S <--> GCA <--> GC
    S <--> TOOLS
    GC <--> CITY
    CITY <--> GDB
    CITY --> RIG
    CITY --> PM
    RIG -. "Factoru project binding" .-> PM
    RIG --> PLAN
    RIG --> WORKERS
    PM --> TOOLS
    PLAN --> TOOLS
    WORKERS --> TOOLS
    PM <--> P
    WORKERS <--> P
    CITY <--> FS
    S <--> FS
```

The server is the security and execution boundary. The desktop never receives
provider credentials and never performs direct database, Gas City, Git,
filesystem, or shell operations.

Factoru Server is also the boundary between Gas City agents and Factoru product
state. Agents receive narrow project-scoped tools; they never open Factoru's
SQLite database.

## Deployment model

Factoru has one runtime architecture and two ways to deploy it.

```mermaid
flowchart TB
    subgraph Local["Local topology"]
        LD["Desktop"] --> LS["Server on localhost"]
    end

    subgraph Remote["Remote topology"]
        RD["Desktop on personal laptop"] -->|"TLS over private or secured network"| RS["Server on Mac mini, Raspberry Pi,<br/>or Linux host"]
    end

    LS --> LGC["Gas City supervisor on server host"]
    RS --> RGC["Gas City supervisor on server host"]
```

The same server artifact, protocol, persistence, and task semantics apply in
both modes. “Run on this device” is a desktop-managed installation and lifecycle
convenience, not an embedded alternate backend.

### Stable server identity

**Partial.** Each Factoru Server receives a stable `server_id` on first start.
Desktop connection profiles bind credentials and cached data to this identity,
not merely to a hostname that may change. Projects are server-local entities.

Implemented today: the id is generated once and stored in a `server-id` file in
the server data directory, created with an exclusive write so concurrent starts
cannot produce two identities. A malformed file is an error rather than a reason
to become a different server. SQLite refuses a mismatched identity, while
Desktop profiles, encrypted credentials, cached projections, and endpoint-spoof
checks are all keyed by that stable ID.

### Access and launch are separate

**Planned.** How the desktop reaches a server is distinct from how that server
was started:

- access may be localhost, private-network HTTPS, user-provided HTTPS, or later
  an SSH/tunnel adapter;
- launch may be a pre-existing service, desktop-managed local service,
  container, or later a desktop-assisted remote installation.

All access methods terminate at the same authenticated Factoru Server API.

### Gas City host compatibility

**Validate.** Gas City publishes macOS arm64/amd64 and Linux arm64/amd64 release
artifacts, but the `gc` binary is not the whole runtime. Current installation
documentation also requires Git, tmux, jq, Dolt, the Beads CLI (`bd`), and
`flock`, plus at least one configured agent harness. Factoru maintains a tested
compatibility manifest for the pinned Gas City release and dependencies rather
than accepting any binaries found on `PATH`.

Server readiness distinguishes: Factoru healthy, Gas City supervisor reachable,
dedicated city ready, bead store ready, required pack resolved, each rig healthy,
and each configured harness/model ready. A failed orchestration dependency must
not make project/task history unavailable.

## Monorepo and dependency boundaries

```mermaid
flowchart TD
    DESKTOP["apps/desktop"] --> UI["packages/ui"]
    DESKTOP --> PROTOCOL["packages/protocol"]
    DESKTOP --> DOMAIN["packages/domain"]
    SERVER["apps/server"] --> PROTOCOL
    SERVER --> DOMAIN
    SERVER --> DATABASE["packages/database"]
    SERVER --> GAS["packages/gas-city"]
    DATABASE --> DOMAIN
    GAS --> DOMAIN
    UI --> DOMAIN
    PACK["packs/factoru-default"] --> GAS
    TEMPLATE["templates/software-project"] --> SERVER
    TEMPLATE --> PACK
```

| Component | Status | Responsibility |
| --- | --- | --- |
| `apps/desktop` | **Partial** | Electron main owns profiles, OS-encrypted credentials, authenticated live transport, project/workspace cache and cursors, and named IPC; the renderer implements onboarding plus the project sidebar, PM conversation, a responsive four-state task board, direct task editing and Queue requests, merge decisions, the Workers inspector, model/memory controls, planner probe, reconnect, and offline states. Managed local launch remains later. |
| `apps/server` | **Partial** | Fastify serves health, handshake, pairing/tickets, scoped live methods, project/workspace/task application services, generic idempotent commands, outbox reconciliation, PM transcript/planner reactors, a loopback session-credential/tool gateway, production Queue dispatch/observation, and live product events. |
| `packages/protocol` | **Implemented** | Runtime-validated compatibility, errors, pairing/ticket, repository/project/device/workspace/conversation/Worker-Type/task/Queue reconciliation, command/query, snapshot/cursor, and live-event contracts plus typed HTTP client. |
| `packages/domain` | **Partial** | Server identity, application version, client connection state, built-in Worker Type/Factory Template invariants, the four task states, Queue phases, exact Needs-you actions, terminal resolutions, and deterministic candidate scoring exist. Richer execution transition policy arrives with Milestone 5. |
| `packages/config` | **Implemented** | Shared TypeScript compiler configuration for every workspace package. |
| `packages/database` | **Implemented** | SQLite connection policy, forward migrations, M2 repositories, transactional event/outbox writes, checkpoint, backup, reopen recovery, M3 product-model persistence/backfill, and M4 task/dependency/event/run/reconciliation/credential/audit persistence. |
| `packages/gas-city` | **Partial** | Factoru-owned orchestration port over Gas City 1.4.0. Compatibility, readiness, supervisor client, event and external-message cursors, guarded/idempotent rig registration, conversation delivery, idempotency-keyed run dispatch, observation/cancellation, and project runtime configuration projection exist; live provider Queue acceptance remains. |
| `packages/ui` | **Implemented** | Factoru visual tokens consumed by the Electron renderer; no transport, product state, or server logic. Reusable React primitives can be promoted only after repeated use appears. |
| `packs/factoru-default` | **Partial** | Four versioned agent-role contracts, prior probes, production role-scoped task tools, and the bounded `queue-reconcile` Formula v2 lint under Gas City 1.4.0. The Milestone 5 `software-delivery` production formula remains planned. |
| `templates/software-project` | **Partial** | The versioned built-in manifest and schema define the pinned pack reference, two Worker Types, named model slots, Formula defaults, provenance-required memory, and WIP-one Factory capacity. Capsule and UI metadata arrive with their owning milestones. |

`apps/desktop` depends on `packages/domain` directly for the client connection
state machine, which is framework-independent product logic rather than a visual
primitive. It does not reach `packages/database` or `packages/gas-city`, and the
renderer reaches nothing privileged at all.

`packages/domain` must not know about Electron, React, SQLite drivers, network
transports, provider SDKs, or Gas City wire formats. Complexity belongs at the
adapter boundary. `packages/protocol` deliberately does not depend on
`packages/domain` either: it owns the wire format, and the server converts
validated wire values into domain value objects at its boundary. These rules are
enforced as ESLint `no-restricted-imports` rules, so a violation fails
`pnpm lint`.

Planned packages exist as directories with a README naming the milestone that
introduces them. They have no package manifest, so nothing in the workspace can
depend on an empty boundary.

## Desktop architecture

**Partial.** The three trust levels, server-ID-bound profiles, OS-encrypted
credential storage, authenticated live runtime, and offline project cache exist;
managed local server lifecycle and packaged remote acceptance remain. Electron
has three trust levels:

```mermaid
flowchart LR
    R["Renderer<br/>untrusted web context"] -->|"Narrow typed IPC"| P["Preload bridge"]
    P --> M["Electron main"]
    M --> C["Connection runtime"]
    C -->|"Authenticated API"| S["Factoru Server"]
```

- **Renderer:** React UI and local presentation state only. Node integration is
  disabled and context isolation is enabled.
- **Preload:** a small allowlisted API. It does not expose raw IPC, filesystem,
  shell, or arbitrary request construction.
- **Main:** windows, updates, OS credential storage, local server lifecycle, and
  connection-profile persistence.
- **Connection runtime:** one owner for authentication, retry/backoff, active
  session, snapshots, subscriptions, compatibility state, and offline caches.

React components do not create sockets, retries, or RPC clients. They consume
domain-specific query, command, and subscription interfaces.

Implemented today: `contextIsolation` is on, `nodeIntegration` is off, the
renderer is sandboxed, and navigation and window-open requests are denied by the
policy described under [security boundaries](#security-boundaries). The preload
bridge exposes named connection, profile, repository, project, conversation,
Worker/model, memory, planner, and device operations—never raw IPC or transport
handles. Electron main owns profiles, encrypted tokens, tickets, the live
socket, retry/coalesced synchronization, cursors, and per-project workspace
cache writes.

Retry policy follows the state machine rather than a single timer: `offline` and
`reconnecting` poll, while `blocked` stops polling entirely because an
incompatible protocol, a rejected credential, or an invalid response cannot be
resolved by trying again. A blocked connection resumes only on an explicit
refresh or a configuration change.

### Connection state machine

**Implemented** in `packages/domain` and exercised by the profile/pairing runtime.
Transport health and data synchronization are
related but distinct.

```mermaid
stateDiagram-v2
    [*] --> Unconfigured
    Unconfigured --> Pairing: add server
    Pairing --> Connecting: credential issued
    Connecting --> Connected: handshake succeeds
    Connecting --> Blocked: authentication or compatibility error
    Connected --> Reconnecting: unexpected disconnect
    Reconnecting --> Connected: replacement session synchronized
    Reconnecting --> Offline: network unavailable
    Offline --> Reconnecting: network returns
    Blocked --> Connecting: credentials, version, or configuration changes
    Connected --> Unconfigured: server profile removed
```

Cached projects/tasks may remain visible while offline, but they must be labeled
as cached. A socket being open does not mean every subscription is synchronized.

## Server architecture

**Partial.** Factoru Server is a modular monolith. It should remain one process
and one deployment until evidence requires otherwise.

Implemented today: a Fastify HTTP/live surface
([ADR 0002](./adr/0002-server-framework.md)) bound to localhost. Health and
handshake are public; pairing, ticket issuance, project/workspace queries, and
mutations are authenticated and scoped. Requests and responses are validated
with shared protocol schemas, and both not-found and error handlers return the
structured `Problem` envelope so no client receives an unstructured failure.

```mermaid
flowchart TB
    API["HTTP and live API"] --> AUTH["Authentication and authorization"]
    AUTH --> APP["Application command/query services"]
    APP --> DOMAIN["Domain policies and state transitions"]
    APP --> TX["Transactional persistence"]
    TX --> STATE[("Current-state tables")]
    TX --> EVENTS[("Domain events and command receipts")]
    EVENTS --> OUTBOX["Post-commit event publisher"]
    OUTBOX --> LIVE["Client subscriptions"]
    OUTBOX --> REACT["Side-effect reactors"]
    REACT --> GAS["Gas City adapter"]
    REACT --> GIT["Git and artifact adapters"]
    GAS --> TOOL["Project-scoped agent-tool gateway"]
    TOOL --> APP
```

### Commands, state, and events

**Implemented through Milestone 4.** Factoru uses the same transactional
state-plus-event model for project, workspace, task, merge-decision, and agent-
tool mutations:

1. Every mutation arrives as a typed command with a unique `command_id`.
2. Authentication and project authorization run before domain decisions.
3. Domain logic validates the transition without performing external side
   effects.
4. One short SQLite transaction updates authoritative state, appends audit/domain
   events, records the command receipt, and adds any outbox work.
5. Events become visible to subscribers only after commit.
6. Reactors consume committed intent and perform Gas City or Git side
   effects, reporting outcomes through new idempotent commands.

This adopts T3 Code's strongest reliability properties—total ordering where
needed, command receipts, pure decisions, transactional projection, and
post-commit side effects—without initially requiring every Factoru read model to
be rebuilt exclusively from an event log.

Never hold a database transaction open while waiting for a model, Gas City,
Git, a test process, or the network.

### SQLite ownership

**Implemented through Milestone 4 state.** Only Factoru Server opens the
database file, which lives on local server storage. Initial requirements:

- SQLite WAL mode using a pinned version containing applicable WAL fixes;
- foreign keys enabled;
- short serialized write transactions and configured busy handling;
- forward-only migrations with migration tests;
- online, consistent backups;
- explicit checkpoint and disk-full monitoring;
- stable IDs, optimistic entity versions, and idempotency keys;
- cursor pagination and indexes matching real UI queries;
- large logs, diffs, and artifacts stored outside rows with durable metadata.

Milestones 2–3 create server metadata, trusted devices, pairing codes, projects,
rig bindings, generic command receipts, domain events, outbox items, projection
cursors, Factory settings, Worker Types/model bindings, conversations/messages,
provenance-aware memory, serialized planner probes, and migrations. Milestone 4
adds tasks, dependencies, task runs, Queue reconciliation, merge proposals,
short-lived agent credentials, and agent-tool audit records.

### Worker types, agents, models, memory, and tools

**Partial.** The Factory/Worker/model/memory path and production role-scoped
task tools are implemented; later execution evidence and memory retrieval remain.
A Factoru **Worker Type** is a
product-level factory profile, not a Gas City primitive. Gas City still launches
every live agent. A worker type may compose several Gas City agent templates and
a formula:

| Worker Type field | Purpose |
| --- | --- |
| Identity | Stable Factoru ID, name, description, and project scope |
| Agent bindings | Gas City templates used for chat, planning, implementation, review, or synthesis |
| Prompt policy | Versioned pack prompt plus Factoru project/role instructions |
| Model bindings | Named slots such as `chat`, `planning`, `implementation`, and `review`, each resolved to a Gas City harness/model/upstream configuration |
| Tool policy | Allowlisted Factoru tools and repository/runtime capabilities per agent binding |
| Memory policy | Which project, role, task, and run memories the binding may read or propose updates to |
| Workflow | Default Formula v2 and validated variables/routes used when work is assigned to this type |
| Capacity | Factoru execution cap plus mapped Gas City agent/rig/workspace session ceilings |

A versioned **Factoru Factory Template** is the accessible configuration bundle
that composes one pinned Gas City pack with Factoru Worker Types, named model
slots, tool/memory policies, Formula defaults, capsule requirements, and UI
metadata. The first template is built in and uses `factoru-default`; later
templates and user formulas extend the same schema rather than creating a
different product mode.

Initial Factoru tool policy is role-specific:

| Agent binding | Factoru tools |
| --- | --- |
| PM chat | Read project/task status, create/edit Backlog thoughts, request Queue movement, search memory, propose memory updates |
| PM planner | Search/reconcile/merge/split tasks, set priority/order/dependencies/resource intent, assign Worker Type/formula, inspect capacity/runs, request clarification |
| Software implementer | Read immutable task/run plan, inspect capsule/config, report progress/evidence/artifacts, search permitted memory |
| Software reviewer | Read request/plan/diff/check evidence, submit structured verdict/findings, search permitted memory; no task-priority or merge authority |

Repository editing, tests, and Git operations remain explicit harness/capsule
capabilities rather than generic Factoru database tools.

The visible **Project Manager** type maps to two Gas City agents: one generated
city-scoped, always-on chat identity per project and one imported rig-scoped,
on-demand `project-manager-planner` with a maximum of one active planning
session. The split is required by the pinned external-message binding contract
and is recorded in
[ADR 0012](./adr/0012-project-manager-runtime-identities.md). The visible
**Software Engineer** type maps initially to an `implementer` pool and an
independent `reviewer` pool. A worker type can therefore use Claude for its
`implementation` model binding and Codex for `review`; a formula routes each
step to the corresponding agent. One Gas City agent still has one effective
harness/model configuration for a session.

Gas City-managed agents/sessions are Factoru's durable worker boundary; Factoru
does not introduce a separate `Subagent` entity. If a provider harness spawns a
native Claude/Codex subagent inside one step, that helper remains opaque and
bounded by the parent step's capsule, permissions, retry budget, and cost. Work
that needs independent status, scheduling, model choice, memory, recovery,
review, or isolation must instead become a bead routed to a Gas City agent/pool.

Gas City separates five runtime axes: harness (historically the agent
`provider` field), model, upstream model service, transport (`tmux` or ACP where
supported), and city-wide session runtime. `packages/gas-city` projects a
Factoru binding to Gas City's `provider` plus `option_defaults.model` fields;
provider-specific option schemas remain on the server side. Unsupported
combinations fail reconciliation before the desired config becomes healthy.

“Worker memory” is not a shared context window. Pool sessions are independent
processes and Gas City deliberately gives them no direct shared memory or
handles. Factoru defines four durable layers:

1. **Project memory:** repository facts, decisions, conventions, and user goals
   shared according to policy.
2. **Role memory:** lessons and preferences scoped to one Worker Type in one
   project.
3. **Task/run context:** the task snapshot, bead history, artifacts, decisions,
   and handoffs for one execution.
4. **Session transcript:** Gas City/provider conversation history for one live
   identity; useful for resume and audit but not the sole durable memory.

Project and role memories are Factoru entities with provenance, versions, and
bounded retrieval. Agents use scoped `memory.search` and `memory.propose_update`
tools; models do not silently append permanent memory. Prompt rendering injects
only a bounded relevant summary, while beads carry current work and handoffs.

Tool delivery is **Validate**. Gas City can catalog pack MCP configuration, but
its current active materializer does not automatically attach configured MCP
servers to every harness. `packages/gas-city` must prove harness-specific MCP,
provider hooks, or a narrow Factoru command/HTTP bridge and present one stable
role-scoped tool contract above those mechanisms. Raw tools are never granted
merely because a model requested them.

## Protocol architecture

**Implemented through Milestone 3; recorded in [ADR 0003](./adr/0003-api-transport-and-protocol.md).**
Use a small HTTP surface for health, pairing, token exchange, and operational
downloads plus a typed live connection for commands, queries, and subscriptions.

Implemented today: `packages/protocol` owns Zod schemas, the advertised protocol
version range, the negotiation rule, the `Problem` error envelope, and a typed
client. Both peers validate at runtime from the same schemas, and the client
re-checks compatibility against its own range instead of trusting the server's
verdict. Pairing and ticket exchange use HTTP; a typed, authenticated WebSocket
carries scoped queries, idempotent commands, project/workspace snapshots,
conversation/Worker/model/memory/planner operations, cursor replay, and live
product events.

The protocol must provide:

- runtime schema validation on both sides;
- `server_id`, protocol version, application version, and capability handshake;
- method-level authorization rather than “connected means fully trusted”;
- unary queries distinct from durable subscriptions;
- command IDs and idempotent retry behavior;
- monotonic event sequence/cursor and snapshot-plus-delta resynchronization;
- bounded subscriptions by project/task instead of full-database broadcasts;
- structured errors that distinguish retryable transport failures from blocked
  authentication, configuration, and compatibility states;
- forward-compatible decoding for additive server capabilities where safe.

Desktop/server compatibility should be negotiated, not inferred from identical
package versions. A deployment may update one side before the other.

## Core product flows

### Pair a desktop

**Partial; implemented locally and awaiting remote acceptance.** A short-lived, one-time pairing credential is exchanged for a
revocable device session. Long-lived credentials are stored in the desktop OS
credential store, not renderer storage. WebSocket authentication uses a
short-lived connection ticket so long-lived tokens do not appear in URLs.

### Backlog capture and Queue reconciliation

**Implemented.** Backlog is a user-editable thought dump. A user can create or edit
a Backlog card directly with minimal structure, and the Project Manager may add
cards from conversation. No Gas City execution bead is required while an item
remains in Backlog.

The transactional Factoru portion is implemented: moving a card from Backlog to
Queue is an explicit command meaning “turn this
into planned, schedulable work.” In one Factoru transaction it changes the
status, records the user action, and enqueues an idempotent
`queue.reconcile` outbox item. Pending requests coalesce through a monotonically
increasing project Queue revision; changes during a running pass create or
coalesce exactly one follow-up record. The reactor creates or reuses a
durable Gas City planning bead routed to `project-manager-planner`; it does not
nudge or interrupt the chat session.

Repeated edits and bursts of Queue changes coalesce by project/version into one
pending reconciliation pass. The planner may use scoped tools to:

```text
search/merge/split tasks
clarify acceptance criteria
set priority and Queue order
add/remove task dependencies and resource locks
select Worker Type and Formula
mark ready, waiting for dependency/capacity, or needs clarification
inspect workers, runs, capsules, and capacity
```

The desktop renders these records as a responsive two-by-two board, collapsing
to one readable column per state at narrow window widths. It supports direct
capture, edit, Queue movement, status changes, terminal resolutions, and user
accept/reject controls for ambiguous merge proposals. The four Kanban statuses
remain stable. Queue planning detail is a separate machine-managed phase—
`awaiting_triage`, `triaging`, `ready`,
`waiting_dependency`, or `waiting_capacity`—shown as a card badge rather than a
new column. PM planning does not move the task to `in_progress`; that status is
reserved for accepted execution. If clarification is required, the task moves
to `needs_you` with an exact question.

The chat session and planning agent may run concurrently because they are
different Gas City identities. Queue reconciliation itself is serialized to one
planner per project to avoid racing priority, merge, and dependency decisions.
The planner is event-driven—Queue changes, dependency changes, run outcomes,
and newly available capacity request a pass—rather than an unbounded token-
consuming loop.

### Conversation to task

**Implemented through task intent.** Each project
conversation has a stable Factoru conversation ID and is bound through Gas
City's external-messaging protocol to that project's generated city-scoped
Project Manager identity.

The documented client-registration plus per-conversation SSE `subscribe` stream
**does not exist in Gas City 1.4.0**. The surface that does exist is a durable
transcript cursor:

| Path | Purpose |
| --- | --- |
| `POST /v0/city/{city}/extmsg/adapters` | Register an adapter; optional `callback_url` and `Idempotency-Key` |
| `POST /v0/city/{city}/extmsg/bind` | Bind a conversation to an `agent_name` or `session_id` |
| `POST /v0/city/{city}/extmsg/inbound` | Deliver one user turn |
| `GET /v0/city/{city}/extmsg/transcript` | Read replies with `after_sequence` and `limit` |
| `POST /v0/city/{city}/extmsg/transcript/ack` | Acknowledge consumption |

Factoru binds to an **agent name** rather than a session ID so the identity is
stable while Gas City replaces sessions. Accepted user messages, bounded
delivery attempts, assistant messages, delivery state, and transcript sequence
are persisted in Factoru SQLite. The reactor resumes reads after that sequence,
deduplicates replay, publishes product events, and treats callback delivery only
as a future latency optimization. The desktop never receives a Gas City address
or token. The generated identity/config decision is in
[ADR 0012](./adr/0012-project-manager-runtime-identities.md); the transport is in
[ADR 0007](./adr/0007-gas-city-compatibility-and-transport.md).

The Project Manager uses a Factoru-owned, project-scoped tool surface to inspect
a bounded set of active/recent reconciliation candidates and request structured
intent:

```text
create task | update existing task | propose merge | ask clarification | no task
```

The chat agent may create a thought in Backlog or explicitly queue it when the
user asks. The tool gateway validates the agent identity and project scope, then
applies task changes through ordinary idempotent commands. A model never writes
the database or sends trusted SQL/commands directly. Ambiguous merges remain
pending until the user accepts or rejects them; only an accepted proposal
resolves the source as `superseded`. Chat prose is not parsed as the authoritative
mutation when a structured tool call exists.

### Task execution and review

**Planned.** The first production flow has a WIP limit of one.

```mermaid
sequenceDiagram
    participant U as User
    participant D as Desktop
    participant S as Factoru Server
    participant G as Gas City
    participant PM as PM planner
    participant W as Claude implementer pool
    participant R as Codex reviewer pool

    U->>D: Add thought to Backlog
    D->>S: Create Factoru task
    U->>D: Move task to Queue
    D->>S: Queue task command
    S->>G: Sling durable queue-reconciliation work
    G->>PM: Route planning bead
    PM->>S: Set priority, dependencies, Worker Type, and Formula
    S-->>D: Stream Queue phase and plan
    S->>G: Materialize eligible workflow when capacity allows
    G->>W: Route ready implementation bead to pool
    W->>G: Close step with changes and evidence
    G->>G: Run deterministic verification step
    G->>R: Route review bead to independent model/session
    alt One correction requested
        G->>W: Materialize bounded correction iteration
        W->>G: Close correction with updated evidence
        G->>G: Re-run checks and review (maximum one correction)
    end
    G-->>S: Cursor-based events and terminal workflow state
    S-->>D: Move task to Needs you with review package
    D-->>U: Clarify, approve, request changes, or resolve conflict
```

The user configures the Software Engineer Worker Type's implementation and
review model bindings. “Multi-agent review” means independent agents, sessions,
and contexts; the reviewer is a binding inside the Software Engineer profile,
not necessarily a third top-level Worker card.

### Gas City boundary

**Partial and requires operational validation.** Factoru uses Gas City's native
model rather than treating it as a generic job runner. The Milestone 2 adapter
now performs guarded, adoptive `rig add → import install → reload`
reconciliation; a real multi-host restart acceptance run remains.

#### Runtime topology

- A Gas City **supervisor** is a machine-level control plane and may host cities
  unrelated to Factoru. Factoru must not stop or reconfigure the entire
  supervisor as though it owns the host.
- Each Factoru Server creates or adopts exactly one dedicated **city**, named
  from its stable `server_id` and rooted under the Factoru server data directory.
- The Factoru city is the local root **pack** plus deployment details. It imports
  a version-pinned `factoru-default` pack. Portable behavior belongs in the
  pack; deployment choices belong in `city.toml`; machine-local paths and
  runtime state belong in `.gc/`/site bindings.
- Each initial Factoru project maps one-to-one to a Gas City **rig** registered
  against its repository path. Factoru persists the city name, rig name, and
  bead prefix as external references, not product identity.
- Gas City uses one city-level Dolt-backed bead store. Rig prefixes are enforced
  as hard query filters by the normal `bd` path, but all rig data is physically
  in the same store and can be reached by a sufficiently privileged process
  that bypasses that query layer. This is logical routing, not an adversarial
  security boundary. The store is separate from Factoru SQLite.

The integration deliberately preserves Gas City's three configuration layers:

| Layer | Factoru location/ownership | Contents |
| --- | --- | --- |
| Portable pack | Versioned `packs/factoru-default` source and pinned deployed import | Agents, prompts, formulas, tool metadata/harness wiring assets, commands, doctor checks, and reusable assets |
| City deployment | Factoru-managed city root | Root `pack.toml`, `city.toml`, rig declarations, provider/harness registrations, runtime policy, and import lock |
| Machine-local site/runtime | City `.gc/` and Gas City-managed runtime directories | Rig path bindings, caches, sockets, logs, sessions, generated state, and Gas City worktrees |

The development harness can initialize this topology only after the tester
explicitly supplies one or more provider names. It uses pinned Gas City 1.4.0
commands to create the city without starting it, adds the local
`factoru-default` pack as a pinned import, installs imports, and then registers
the city with `--no-auto-restart` so it never restarts a drifting machine-wide
supervisor that may host unrelated cities. This is a testing path, not a decision
about the production first-run provider experience.

Registering a rig also creates Gas City/Beads metadata in the repository (for
example `.beads/` configuration pointing to the city endpoint). Project setup
must preview, verify, and document this mutation; project removal must not
silently delete it or user work.

Gas City's six primitives and related runtime concepts map to Factoru as follows:

| Gas City concept | Gas City meaning | Factoru use | Product/UI rule |
| --- | --- | --- | --- |
| City | Root pack plus one machine deployment | Dedicated orchestration environment for one Factoru Server | Hidden under server health/settings; not a user project |
| Rig | Registered external project/repository and bead namespace | One rig per repository-backed Factoru project initially | Factoru project remains the user-facing identity |
| Pack | Versioned agents, formulas, orders, prompts, commands, tools, and checks | `factoru-default` supplies Factoru's orchestration behavior | Custom packs are trusted code and require a later explicit trust flow |
| Agent | One configured runtime role: prompt, scope, harness, model, tools/hooks, work query, and pool policy | Low-level chat, planner, implementer, and reviewer bindings behind Factoru Worker Types | Workers edits the product profile; it does not expose raw TOML initially |
| Session | One live disposable instance of an agent | PM chat is always-on; planning is serialized on demand; implementer/reviewer roles scale on demand | A session is not a Worker Type or a Factoru device/login session |
| Bead | Durable universal work unit | Workflow root and step execution state | Never render every bead as a Kanban task |
| Formula | Reusable method compiled into a routed bead graph | Queue reconciliation and software-delivery methods composed from several agent roles | It defines the work flow, not the Worker Type |
| Convoy | Grouping bead with `tracks` edges | Later groups decomposed work and feeds drain/fan-out | Not an MVP task list or status column |
| Event | Immutable sequenced observation | Source for run projection, recovery, logs, and health | Factoru translates it into bounded product events |
| Order | Trigger plus formula or trusted exec action | Later scheduled maintenance/automation | Not used to select user tasks; Factoru owns Queue/WIP policy |

#### Agent and session shape

The default pack contains rig-scoped `project-manager-chat` source material,
`project-manager-planner`, `software-implementer`, and `software-reviewer`
agents. Gas City 1.4.0 external-message bindings require a city-scoped agent, so
Factoru generates one deterministic city-local chat agent per project and a
root-pack `mode="always"` named session for it. The portable chat definition is
the versioned prompt/policy source, not the live rig target. The planner has
`max_active_sessions=1`; implementer and reviewer templates are on-demand pools.
Factoru applies project model choices through bounded root-pack/city managed
blocks and reloads only after a byte change
([ADR 0012](./adr/0012-project-manager-runtime-identities.md)).

Do not configure a pool minimum on the chat template. Gas City treats an
always-on named session and `min_active_sessions` as independent sources of live
sessions and its doctor warns about accidental combinations. Chat continuity and
planning concurrency therefore use different agent templates even though the
Factoru UI groups them as one Project Manager Worker Type.

Agents coordinate indirectly through routed work, beads, and mail; Factoru does
not add direct agent-to-agent process handles. The Project Manager's exception is
not direct worker control: it calls Factoru product tools to reconcile tasks,
selects a Worker Type/formula, and expresses task dependencies. Gas City routes
ready formula steps to a role/pool and chooses concrete session identities. This
keeps authorization outside prompts and keeps runtime assignment in the
orchestrator.

#### Task and bead correlation

A Factoru task is product intent and may have zero, one, or many attempts. Each
`task_run` records at least the Gas City city/rig, formula identity and resolved
version, workflow-root bead ID, optional convoy ID, starting event cursor,
request/correlation IDs, terminal disposition, and artifact references. Formula
step beads stay Gas City-owned execution detail.

There is intentionally no one-to-one status mapping:

- Factoru `backlog` has no Gas City work; `queue` may have a correlated PM
  planning bead but no implementation workflow until its plan is accepted;
- Factoru enters `in_progress` only after a run is accepted and correlated;
- Gas City `open`, derived `blocked`/`deferred`, `in_progress`, and `closed`
  describe execution readiness, not Kanban policy;
- a closed workflow produces a review package and moves the Factoru task to
  `needs_you`; failed, cancelled, or exhausted workflows also move there with a
  precise requested action unless policy safely requeues them.

Duplicate-task reconciliation occurs before dispatch in Factoru. It must not be
implemented by merging arbitrary Gas City beads.

#### Formula and run lifecycle

The `factoru-default` pack initially supplies two Formula v2 methods:

- `queue-reconcile` routes durable planning work to the serialized PM planner;
- `software-delivery` routes independently executable steps to the Software
  Engineer Worker Type's implementer and reviewer bindings.

`software-delivery` has independently routable steps and durable `needs` edges.
Its accepted contract is:

1. prepare and validate the task/run inputs;
2. implement through the Worker Type's `implementation` model binding;
3. run deterministic checks without constructing shell from task text;
4. review through its independent `review` model binding/session;
5. allow at most one correction iteration, then re-run checks and review;
6. finalize to a structured terminal result for Factoru to package.

Use `check` for bounded judgment/correction loops and `retry` only for classified
transient failures. Retried bodies must be idempotent because Gas City's control
plane is idempotent but an agent's external side effects are not. The formula's
compiler requirement, resolved pack/formula version, variables, routes, and
budgets are validated and recorded before dispatch.

Validation is stricter than syntax acceptance in the pinned Gas City release.
Factoru must reject or compensate for constructs the current Formula v2 runtime
accepts but does not fully enforce: `until` re-executes only once, gate type and
`waits_for` modes have no bundled runtime consumer, and variable `type` is not
enforced. Prefer `check` for bounded iteration and `drain` for fan-out, enforce
Factoru variable schemas before materialization, honor the drain unit cap, and
do not route v2 work through `gc converge`. Rig-scoped formulas are cooked and
slung in the rig store the target reads; cross-store routing is treated as a
configuration error, not retried against another scope.

A Formula owns the reusable execution method, not the whole user experience.
Factoru continues to own chat, Backlog and Kanban state, Worker Types, Factory
policy, permissions, durable memory, human decisions, and the task/run
projection around it. The UI initially shows concise stages and evidence, then
progressively exposes the selected run's Formula graph, beads, sessions,
dependencies, and controls in those same surfaces. There is no simple/advanced
mode boundary or alternate state model.

#### Parallelism and capacity

**Deferred until capsules, but part of the accepted model.** The project Factory
setting is `max_parallel_implementation_workers`. Setting it to three means at
most three `software-implementer` sessions may execute three eligible task units
at once; it does not promise three will always run.

The Project Manager decides logical eligibility by recording Factoru task
dependencies, resource conflicts/locks, Worker Type, formula, and priority. It
does not choose `SE 1` or `SE 2`. Factoru validates the plan and admits ready
tasks up to the project cap. Gas City then enforces materialized `needs` edges,
routes ready beads to the implementer pool, and scales concrete sessions up to
the mapped `max_active_sessions` limit.

Gas City also has rig- and workspace-level total session caps. Factoru reserves
capacity for the PM chat, serialized planner, reviewers, and control sessions so
the user-facing implementation cap is not accidentally consumed by the
always-on PM. The effective limit is always the minimum of Factoru policy, Gas
City role/rig/workspace caps, provider quotas, healthy capsule capacity, and
host CPU, memory, storage-I/O, and service pressure.

Four cloud-model implementation sessions on an 8 GB Raspberry Pi-class Linux
host are a benchmark target, not an architectural guarantee. The Linux arm64
spike must measure representative builds and task-specific services from one
through four sessions plus Dolt/backup growth and compaction cost; runtime
admission reduces effective capacity when host headroom is insufficient.

Cross-task dependencies remain authoritative Factoru product relations. When a
run or convoy is materialized, the adapter snapshots them into Gas City `needs`
edges; that execution snapshot is then Gas City-owned and is not separately
edited from both systems. Formula v2 drain with `context="separate"` is the
preferred later fan-out mechanism after tier-one capsules are proven.

Factoru dispatches accepted tasks explicitly with the typed supervisor control
plane (the equivalent of formula sling). Gas City **orders** do not consume the
Factoru Queue in the MVP, because that would create a second scheduler. Later,
orders may run maintenance or event-driven automation that has an explicit
Factoru policy.

#### Adapter contract

The adapter prefers Gas City's typed REST/SSE API. The authoritative OpenAPI
contract is pinned from the tested Gas City release/repository link identified
by the API reference, not assumed from the documentation site's generic
`/api-reference/openapi.json` path. Factoru pins the `gc` CLI and API contract to
the same release and generates clients from that artifact.

Adapter implementation may use three mechanisms behind the same Factoru-owned
operations, selected only from evidence in the pinned contract: typed REST/SSE
for supported runtime operations; validated generation/patching plus controller
reload for Factoru-owned desired configuration; and `gc --json` for proven
install/doctor or compatibility gaps. An operation name below does not promise
one particular transport. Human-readable CLI output is never parsed, and
Factoru never edits Gas City-generated runtime state as configuration.

The adapter exposes Factoru-owned operations such as:

```text
validateInstallation
ensureSupervisor
ensureCity
installAndPinPack
registerRig
applyWorkerTypeBindings
ensureProjectManagerChatSession
sendProjectManagerTurn
observeProjectManagerReplies
requestQueueReconciliation
observePlanningWork
readCapacity
validateFormula
startRun
observeRun
cancelRun
recoverRuns
describeRun
```

Mutation requests carry Gas City's required anti-CSRF header; request IDs are
captured for diagnostics; Problem Details error codes are mapped to stable
Factoru errors. Event and reply SSE consumers persist sequence cursors and resume
with supported cursor/`Last-Event-ID` semantics. A `202 Accepted` is not treated
as completion; Factoru correlates the terminal request event or reconciles the
resource after restart.

Gas City IDs and payloads remain inside the adapter or dedicated persistence
records. The operational spike must test named-session chat, tool authorization,
Formula and rig endpoint coverage, event replay, duplicate delivery, restart
adoption, cancellation, partial failure, config reload, upgrades, `.beads/`
effects on existing repositories, and Linux arm64 before Raspberry Pi is
declared supported.

### Worktree capsules

**Planned tier one; later tiers deferred.** A capsule is one Factoru-owned
resource-lease identity for one task run or independently scheduled Formula
unit. It is not created per ephemeral agent session. Implementation, checks, and
review for the same run use the same capsule/worktree, with role-appropriate
write permissions and auditable access.

| Tier | Isolation | Roadmap policy |
| --- | --- | --- |
| **1 — Worktree** | Git worktree/branch plus Factoru port, environment, process, log, health, lock, artifact, and cleanup leases | Required for the single-task production loop and before concurrency |
| **2 — Project services** | Tier one plus task-specific Docker Compose identity, application-service containers, networks, volumes, database namespace, and CPU/memory/log limits | Added for projects whose runtime services need isolation |
| **3 — Full worker** | Tier two plus the provider harness and agent tools inside the capsule container | Optional later hardening; never one container per ephemeral session by default |

**Resolved by the Milestone 1 gate; recorded in
[ADR 0008](./adr/0008-worktree-ownership.md).** The preferred split assumed Gas
City owns worktree creation and cleanup. A real two-step Formula v2 run created
**no worktree at all**: `git worktree list` showed only the main worktree, and
both the implementer and reviewer ran in the rig's primary repository path.

What the gate observed is precisely that **an ordinary non-drain workflow
creates no worktree**. The explanation — that Gas City creates them for
`[steps.drain] context = "separate"` fan-out units — comes from the Formula
guide and was not itself exercised, because the probe formula uses no drain.
The decision below only depends on the observation, not on the explanation.

The accepted ownership for the single-task loop is the architecture's documented
fallback, adopted on evidence:

- **Factoru** creates and removes the Git worktree and branch for one task run,
  and passes the validated path to Gas City as the run's working directory;
- **Factoru** also owns the capsule record and every non-Git lease: ports,
  process supervision, service containers, databases, logs, limits, health,
  retention, and cleanup policy;
- the implementer and reviewer steps of one run share that worktree, with
  role-appropriate permissions;
- no lifecycle operation has two owners. Factoru does not adopt `drain` fan-out
  merely to obtain a worktree.

Milestone 8 must re-examine this: real parallelism through `drain` with
`context = "separate"` would make Gas City create worktrees too, which is
exactly the dual ownership this forbids. That change is made as one decision,
not incrementally.

Tier two keeps the Gas City/provider session on the host and containerizes the
project runtime. This avoids passing broad Docker access and provider credentials
into every worker while still isolating the services most likely to collide.
Tier three must prove provider hooks, authentication, caches, tool transport,
filesystem ownership, network policy, and Linux compatibility before adoption.
No worker receives the Docker socket or privileged mode merely to manage its own
capsule.

## State ownership

| State | Authoritative owner | Factoru may store |
| --- | --- | --- |
| Projects, conversations, tasks, task dependencies, Worker Types, model bindings, capacity policy | Factoru database | Authoritative records and history |
| Project and role memory | Factoru database/artifact store | Authoritative versioned entries, provenance, summaries, and retrieval metadata |
| Pairing credentials and sessions | Factoru Server authentication store | Authoritative hashes/metadata; secrets in appropriate secret stores |
| Project Manager message history | Factoru database | Authoritative product transcript; Gas City transcript/binding references for delivery and recovery |
| Gas City city, rig, pack, agent, and session runtime | Gas City configuration/supervisor | Desired Factoru configuration, external IDs, health, and last reconciliation result |
| Formula execution and bead readiness | Gas City | Workflow/convoy/bead IDs, versions, cursors, cached projection, summarized evidence |
| Commits, branches, and diffs | Git | References, intended lifecycle, cached summaries |
| Worktree lifecycle | Factoru Server and Git ([ADR 0008](./adr/0008-worktree-ownership.md)) | Task/capsule/run correlation, path reference, health, and cleanup outcome |
| Capsule identity, resource leases, limits, and retention policy | Factoru database | Authoritative desired allocation and lifecycle history |
| Live processes, containers, ports, networks, volumes, and database instances | OS/container runtime | Runtime handles/PIDs, observed health, usage, and reconciliation state |
| Provider credentials | Server secret store/provider CLI | References and redacted availability only |
| Large logs and artifacts | Server artifact storage | Metadata, content hash, size, retention, and access policy |
| Desktop connection profiles | Desktop main process | Server identity, endpoint hints, credential references, cache cursors |

Cached external state must be reconstructible. No UI projection may become an
independently editable second truth.

## Reliability and recovery

**Partial.** Milestones 2–3 implement transactional command
receipts/events/outbox, bounded provisioning and chat-delivery retries,
immediate outbox recovery, project and transcript cursor resumption, coalesced
desktop synchronization, planner cancellation/observation, and online verified
backups. Later orchestration adds the remaining behavior:

- idempotent commands survive retries after uncertain responses;
- accepted intent is persisted before external work starts;
- server startup replays incomplete outbox work and reconciles active Gas City
  runs, the dedicated city, rig registrations, and Project Manager sessions;
- Gas City event and external-message streams resume from persisted cursors and
  tolerate duplicate delivery;
- repeated Queue changes coalesce without running concurrent planners for the
  same project/version, and stale planning writes fail optimistic checks;
- permanent memory updates retain source/provenance and cannot silently
  overwrite a newer user or agent revision;
- subscriptions resume from a cursor or request a fresh bounded snapshot;
- task/run state changes include causation and correlation IDs;
- every retry and agent correction loop is bounded and observable;
- cancellation is a durable requested state followed by a confirmed outcome;
- task completion is not inferred solely from a provider stream ending;
- online backups and restore drills are milestone acceptance criteria;
- Gas City/Dolt disk growth is measured per task/run and alerted before storage
  pressure; health reports compaction eligibility, last successful compaction,
  quarantine, backup growth, and free-space headroom;
- the pinned Dolt pack's maintenance order may run compaction under explicit
  Factoru operational policy. Recovery planning accounts for full-GC requiring
  writers to stop and potentially about twice the current store size in free
  space;
- logs and metrics identify server, project, task, run, and command without
  including secrets or raw sensitive prompts by default.

## Security boundaries

**Partial.** The server remains loopback-bound. Remote access terminates HTTPS at
an explicitly trusted loopback proxy/private overlay
([ADR 0011](./adr/0011-milestone-2-remote-access-and-project-onboarding.md));
native TLS and non-loopback Factoru binding are deferred. Pairing, device-token
authentication, one-time WebSocket tickets, and method scopes are implemented.
Health and handshake remain unauthenticated by design and expose no project
state; Gas City and Dolt remain host-local.

The renderer trust boundary is implemented: context isolation on, node
integration off, sandbox on, and a preload bridge that exposes only named
connection/profile/project/device operations rather than raw IPC.
Renderer-initiated navigation is
allowed only to the exact origin of the development renderer, compared by parsed
origin rather than string prefix, and window-open requests are always denied —
their URL reaches the operating system's default handler only when it is `http:`
or `https:`, so renderer content cannot launch local files or custom-protocol
applications.

Initial trust boundaries:

- the renderer is untrusted relative to Electron main;
- every desktop/server payload is untrusted until decoded;
- Gas City's direct remote read plane is unauthenticated, and `X-GC-Request` is
  an anti-CSRF presence check rather than authorization. Factoru therefore keeps
  every supervisor/controller and managed Dolt listener on loopback or an
  equivalent private host boundary, never exposes or reverse-proxies those
  listeners to desktops, and performs remote access only through Factoru's
  authenticated API;
- the host-local Gas City supervisor and every city reachable by a host-running
  agent are one single-operator trust domain for the MVP. Rig-prefix filtering
  prevents accidental normal-CLI crossings but is not confidentiality or
  adversarial authorization. Coexisting unrelated cities are supported only
  when the operator accepts that trust domain; Factoru surfaces a warning and
  never claims cross-city secrecy;
- backlog text, task fields, bead/mail content, memory proposals, and all model
  output are untrusted data and can only request allowlisted domain tools;
- every agent-tool credential is short-lived or revocable, bound to one project
  and role, and accepted only on a server-local/internal listener;
- project/role-scoped Factoru tool authorization protects Factoru product state;
  it does not turn Gas City's host-local CLI, API, or shared Dolt store into a
  project sandbox, and product copy must not imply otherwise;
- repository paths are validated against registered project roots;
- project commands are declared configuration, not arbitrary model-generated
  shell strings;
- pairing links are short-lived secrets and sessions are revocable;
- provider/repository credentials never enter renderer state or normal logs;
- artifact download paths use opaque IDs rather than filesystem paths;
- Factory Template manifests, city config, Formula v2 files, pack commands, MCP
  configuration, imported packs, and exec/session-provider scripts are trusted
  configuration or executable dependencies; they must be pinned, reviewed, and
  never assembled from untrusted task text.

Tier-one worktrees and tier-two project-service containers are collision and
failure-isolation mechanisms, not a sandbox for a malicious host-running agent:
that agent can still reach host-local control planes allowed to its OS user.
Only a tier-three worker with the agent inside an unprivileged container (or
equivalent runtime), explicit filesystem mounts, no Docker socket, and default-
deny access to Factoru/Gas City/Dolt listeners may claim an agent security
boundary. Repositories remain trusted single-tenant code until that tier is
proven.

## What Factoru learns from T3 Code

This analysis reviewed T3 Code's repository and maintainer documentation on
2026-08-04. T3 Code remains a reference; no source code or dependency is copied
by this decision.

| T3 Code approach | Lesson for Factoru | Decision |
| --- | --- | --- |
| Server owns providers, Git, terminals, filesystem, and durable sessions; clients use one authenticated RPC boundary. | A remote-capable agent product needs one clear execution boundary. | **Adopt.** Factoru Desktop remains an unprivileged client. |
| Shared runtime-validated contracts and typed unary/streaming RPC. | Schema drift and ad-hoc push messages become expensive quickly. | **Adopt the principle.** Select the smallest suitable TypeScript library in an ADR. |
| One connection supervisor owns retries, offline state, credentials, and session replacement. | Multiple retry owners create lying UI and duplicate work. | **Adopt.** Keep transport attempts single-shot underneath it. |
| Stable environment identity is separate from changing endpoints. | Hostnames and LAN addresses are not durable identities. | **Adopt** as `server_id` plus client connection profiles. |
| Access method is separate from server launch method. | SSH, Tailscale, localhost, and tunnels should not fork product semantics. | **Adopt.** Start with localhost and user-secured remote HTTPS. |
| Method-level scopes plus one-time pairing and revocable sessions. | Possessing a socket must not authorize every privileged action. | **Adopt**, initially with a smaller Factoru scope set. |
| Commands become persisted events and projections in one transaction; command receipts make retries idempotent. | This gives strong crash/retry behavior and ordered state changes. | **Adapt.** Use authoritative state tables plus event/outbox and receipts first; consider full event sourcing only with evidence. |
| Side effects run in queue-backed reactors after intent is committed. | Provider/Git failures should not corrupt domain transactions. | **Adopt.** Outcomes re-enter through commands. |
| Provider driver registry normalizes several agent runtimes. | Worker roles must not be coupled to one provider protocol. | **Adapt.** Gas City owns provider runtimes; Factoru normalizes Worker Type model bindings and capabilities at its adapter. |
| Hidden Git checkpoints bracket agent turns and support exact diff/revert. | Review and recovery need durable baselines, not only working-tree snapshots. | **Adapt.** Evaluate checkpoints together with task worktrees and Gas City ownership. |
| Worktree-specific state and stable derived development ports. | Development tooling itself must not collide across worktrees. | **Adopt in the Milestone 0 walking skeleton**, including per-worktree server data directories. |
| Bounded subscriptions and cached/offline projections. | Broadcasting or hydrating all history will eventually hurt responsiveness. | **Adopt.** Design cursor pagination and project/task subscriptions initially. |
| Electron is a shell around a separately runnable server/web runtime. | Local and remote operation should share one backend artifact. | **Adopt the deployment principle**, while building Factoru's original UI. |
| Effect, Effect RPC, Atom state, and a fully event-sourced orchestration engine. | These solve real problems but introduce a substantial conceptual stack. | **Do not copy automatically.** Choose them only if a focused spike beats simpler alternatives. |
| Web, desktop, mobile, relays, SSH launch, multiple VCS hosts, terminals, and many providers. | Mature breadth is useful evidence, but it is not Factoru's starting scope. | **Defer.** Protect the single-task product loop. |

Two especially important operational lessons:

1. T3 Code's repository rules isolate development state inside each worktree and
   derive stable ports from the worktree. Factoru must do this for its own
   monorepo before it tries to offer capsules to users.
2. T3 Code has already needed to bound catch-up replay and avoid full-database
   snapshot hydration. Factoru should begin with cursor-based bounded sync rather
   than discover that constraint after accumulating task history.

T3 Code's current documents are not perfectly synchronized: an older provider
architecture page says only Codex is implemented, while its maintained overview,
README, package dependencies, and provider registry describe five built-in
drivers. Factoru therefore treats architecture status as a maintained inventory,
not prose that can remain untouched after implementation changes.

## Decisions still requiring ADRs or spikes

Accepted decisions live in [`docs/adr/`](./adr/README.md). Milestone 0 recorded
the monorepo toolchain (0001), server framework (0002), API transport and
protocol contract (0003), database and migrations (0004), packaging (0005),
per-worktree development state (0006), Gas City boundaries (0007–0010), remote
onboarding (0011), and Project Manager runtime identities (0012).

| Decision | Status | Required evidence |
| --- | --- | --- |
| Server framework and runtime | **Accepted** — [ADR 0002](./adr/0002-server-framework.md) | Fastify serves the health/handshake slice on macOS. Remote streaming, cancellation, and Linux arm64 viability are re-checked in Milestones 2 and 5. |
| Protocol/RPC library | **Accepted** — [ADR 0003](./adr/0003-api-transport-and-protocol.md) | HTTP/JSON with shared Zod schemas, validated on both sides. Subscriptions, auth hooks, and reconnection are proven in Milestone 2 before the choice is treated as settled for live traffic. |
| SQLite driver and migration tool | **Accepted, partially proven** — [ADR 0004](./adr/0004-database-and-migrations.md) | `better-sqlite3` with hand-written forward-only migrations now passes WAL, foreign-key, busy handling, rollback, identity binding, checkpoint, online-backup, integrity-restore, and restart tests. Native packaging and recovery benchmarks on every early target remain. |
| Desktop and server packaging | **Accepted, unproven** — [ADR 0005](./adr/0005-packaging.md) | electron-builder plus a bundled Node service and container image; signing, notarization, and per-platform builds are Milestone 7 evidence. |
| Worker Type binding compiler | **Partial** — [ADR 0012](./adr/0012-project-manager-runtime-identities.md) | Provider and `option_defaults.model` bindings project to the correct city/rig agents without leaking raw config into the domain. Prompt/tool/formula and provider-catalog UI integration remain. |
| Gas City supervision/install strategy | **Validate** | macOS and Linux installs, version pinning, upgrades, health, and recovery. |
| Dedicated city and project-rig lifecycle | **Validate** | Coexist with unrelated supervisor cities, stable naming, rig add/remove, repository `.beads/` effects, and safe recovery. |
| Supervisor trust-domain deployment | **Validate** | Loopback-only listeners, warning for unrelated cities, and whether confidential coexistence requires a dedicated OS user/supervisor. |
| Project Manager session isolation | **Accepted, partially proven** — [ADR 0012](./adr/0012-project-manager-runtime-identities.md) | Stable per-project city-local named agents satisfy external-message binding and generated config resolves under 1.4.0. Concurrent real project chats and restart acceptance remain. |
| Project Manager chat/planner split | **Partial** — [ADR 0012](./adr/0012-project-manager-runtime-identities.md) | Durable chat and one coalesced production Queue reconciliation are separate paths; bounded dispatch, terminal observation, and unit coverage prove chat remains independent. Real provider/restart acceptance remains. |
| Factoru agent-tool transport | **Accepted** — [ADR 0010](./adr/0010-agent-tool-transport.md) | Factoru writes each harness's MCP config from `session_setup_script` with a per-session, role-scoped credential. Proven through Claude and Codex. Gas City catalogues pack MCP but does not attach it, exactly as suspected. |
| Durable memory storage/retrieval | **Partial** | Provenance-required versioned project/role storage and Desktop editing exist. Bounded retrieval/prompt injection, deletion, relevance, and resistance to poisoned model content remain. |
| Capacity mapping | **Validate** | Factoru implementation cap maps correctly to agent/rig/workspace session caps while reserving PM, reviewer, and control capacity. |
| Factory Template manifest | **Implemented for the built-in template** | Versioned schema composes the pinned pack reference, fixed Worker Types/model slots, tool/memory policies, Formula defaults, and WIP-one capacity. Capsule/UI extension fields remain milestone-owned. |
| Default pack installation and patching | **Partial** — [ADR 0012](./adr/0012-project-manager-runtime-identities.md) | Worker model updates generate bounded idempotent city/root-pack regions, preserve unrelated config, reload on change, and resolve under Gas City 1.4.0. Live rollback and doctor acceptance remain. |
| Gas City API compatibility policy | **Accepted** — [ADR 0007](./adr/0007-gas-city-compatibility-and-transport.md) | Pinned to 1.4.0 with a `>=1.4.0 <1.5.0` range. The authoritative contract is the OpenAPI document served by the running supervisor at `/openapi.json`, which diverges from the documentation site. |
| Formula semantic validator | **Validate** | Enforce Factoru variable schemas and reject inert/deprecated/unsupported v2 constructs and cross-store routes for the pinned release. |
| Gas City versus Factoru capsule lifecycle | **Accepted** — [ADR 0008](./adr/0008-worktree-ownership.md) | A real run created no worktree, because Gas City only creates them for `drain` fan-out units. Factoru owns worktree lifecycle for the single-task loop; re-examined in Milestone 8. |
| Rig registration safety | **Accepted** — [ADR 0009](./adr/0009-rig-registration-safety.md) | `gc rig add` commits to the target repository and captured a staged user change. Factoru requires a clean index and discloses every mutation. |
| Tier-two container policy | **Validate** | Compose identity, ports, volumes/databases, limits, logs, secrets, health, recovery, and cleanup on macOS and Linux without exposing the Docker socket to workers. |
| Raspberry Pi capacity | **Validate** | Linux arm64 benchmark with representative builds/services and one through four cloud-model sessions on an 8 GB host; derive safe dynamic admission thresholds. |
| Dolt growth and compaction | **Validate** | Per-run store/backup growth, early disk warning, compactor order behavior, quarantine, and a full-GC recovery drill with sufficient headroom. |
| Local server lifecycle | **Validate** | Login service versus managed process versus container UX and failure recovery. |
| Remote TLS onboarding | **Accepted, awaiting remote acceptance** — [ADR 0011](./adr/0011-milestone-2-remote-access-and-project-onboarding.md) | Operator-controlled HTTPS overlay/reverse proxy forwards only Factoru from loopback; native TLS lifecycle is deferred. |

Record accepted choices as ADRs under `docs/adr/` and update this document's
status and diagrams in the same change.

## References

- [T3 Code repository](https://github.com/pingdotgg/t3code)
- [T3 Code architecture overview](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md)
- [T3 Code workspace layout](https://github.com/pingdotgg/t3code/blob/main/docs/internals/workspace-layout.md)
- [T3 Code connection runtime](https://github.com/pingdotgg/t3code/blob/main/docs/architecture/connection-runtime.md)
- [T3 Code remote architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md)
- [T3 Code environment authentication](https://github.com/pingdotgg/t3code/blob/main/docs/internals/environment-auth.md)
- [T3 Code source control](https://github.com/pingdotgg/t3code/blob/main/docs/user/source-control.md)
- [T3 Code repository instructions](https://github.com/pingdotgg/t3code/blob/main/AGENTS.md)
- [Gas City documentation](https://docs.gascity.com/)
- [Gas City tutorials](https://docs.gascity.com/tutorials)
- [How Gas City works](https://docs.gascity.com/getting-started/how-gas-city-works)
- [Gas City dashboard and loopback security posture](https://docs.gascity.com/getting-started/dashboard)
- [Gas City installation and runtime dependencies](https://docs.gascity.com/getting-started/installation)
- [Gas City connected clients](https://docs.gascity.com/guides/connected-clients)
- [Gas City context, state, history, roles, and identity](https://docs.gascity.com/guides/capabilities-for-coding-agent-users)
- [Gas City configuration reference](https://docs.gascity.com/reference/config)
- [Gas City packs](https://docs.gascity.com/guides/understanding-packs)
- [Gas City agents tutorial](https://docs.gascity.com/tutorials/02-agents)
- [Gas City sessions tutorial](https://docs.gascity.com/tutorials/03-sessions)
- [Gas City formulas](https://docs.gascity.com/guides/understanding-formulas)
- [Gas City Formula v2 specification](https://docs.gascity.com/reference/specs/formula-spec-v2)
- [Gas City supervisor API](https://docs.gascity.com/reference/api)
- [Gas City bead storage topology](https://docs.gascity.com/reference/internal/beads-topology)
- [Gas City command trust boundaries](https://docs.gascity.com/reference/trust-boundaries)
- [Gas City direct-hardened deployment and unauthenticated read plane](https://docs.gascity.com/runbooks/remote-hardened-city)
- [Gas City Dolt bloat recovery and prevention](https://docs.gascity.com/troubleshooting/dolt-bloat-recovery)
- [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [Factoru roadmap](./ROADMAP.md)
- [Factoru decision records](./adr/README.md)
- [Factoru deferred graph orchestration](./future/graph-orchestration.md)
