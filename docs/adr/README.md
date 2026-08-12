# Architecture decision records

Short records of consequential technical choices. Each ADR states the context,
the decision, and its consequences, including what would make Factoru revisit it.

`docs/ARCHITECTURE.md` remains the current summary of the system; an ADR keeps
the historical reasoning behind one decision.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](./0001-monorepo-toolchain.md) | pnpm workspaces, TypeScript, and the shared verification commands | Accepted |
| [0002](./0002-server-framework.md) | Fastify as the Factoru Server framework | Accepted |
| [0003](./0003-api-transport-and-protocol.md) | HTTP/JSON with Zod-validated shared schemas; live transport deferred | Accepted |
| [0004](./0004-database-and-migrations.md) | SQLite via `better-sqlite3` with hand-written forward-only migrations | Accepted, implemented |
| [0005](./0005-packaging.md) | electron-builder for Desktop; bundled Node service and container for Server | Accepted, not yet implemented |
| [0006](./0006-per-worktree-development-state.md) | Per-worktree development state and derived ports | Accepted |
| [0007](./0007-gas-city-compatibility-and-transport.md) | Gas City 1.4.0 pin, supervisor-served OpenAPI, and the adapter transport map | Accepted |
| [0008](./0008-worktree-ownership.md) | Factoru owns worktree lifecycle for the single-task loop | Accepted |
| [0009](./0009-rig-registration-safety.md) | Rig registration requires a clean index and discloses its mutations | Accepted |
| [0010](./0010-agent-tool-transport.md) | Factoru installs its own agent tools from `session_setup_script` | Accepted |
| [0011](./0011-milestone-2-remote-access-and-project-onboarding.md) | Milestone 2 remote access and project onboarding | Accepted |
| [0012](./0012-project-manager-runtime-identities.md) | One generated city-scoped Project Manager chat identity per project | Accepted |
| [0013](./0013-local-desktop-enrollment.md) | Private restart-scoped local enrollment without renderer credential access | Accepted |
| [0014](./0014-multi-repository-projects.md) | Projects own one or more ordered repository-backed rigs | Accepted, partially implemented |
| [0015](./0015-manual-ssh-preview-transport.md) | Manual SSH loopback forwarding for remote source previews | Accepted for developer preview; acceptance pending |
| [0016](./0016-concurrent-desktop-server-connections.md) | One independent Desktop connection per saved server profile | Accepted; routing superseded by 0017 |
| [0017](./0017-factory-independent-project-catalog.md) | Aggregate projects across factories while routing through one authoritative home factory | Accepted |
| [0018](./0018-managed-project-directories.md) | One server-owned directory per project with managed repository imports | Accepted, implemented for new projects |
| [0019](./0019-blueprints-formula-presets-and-project-manager-boundary.md) | Project Blueprints, selectable Formula Presets, and the Factoru Project Manager boundary | Accepted, implemented; Standard Build acceptance pending |
| [0020](./0020-desktop-shell-and-ui-foundation.md) | Frameless native-control Desktop shell, responsive panes, and shared React UI foundation | Accepted, implemented |
| [0021](./0021-scoped-streams-over-existing-websocket.md) | Bounded resource subscriptions over the existing authenticated WebSocket | Accepted, implemented |
| [0022](./0022-conversation-context-reset-preserves-transcript.md) | Reset provider context while preserving the durable Factoru transcript | Accepted, implemented |
| [0023](./0023-orchestration-projections-splits-review-and-memory.md) | Run projection ownership, split semantics, specialist review routing, and memory trust | Accepted, implemented; provider acceptance pending |

## Writing a new ADR

Copy the structure of an existing record: a `# NNNN — Title` heading, then
**Status**, **Context**, **Decision**, **Consequences**, and **Revisit when**.
Number sequentially and link the ADR from the relevant architecture section.
