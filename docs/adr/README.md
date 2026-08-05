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
| [0004](./0004-database-and-migrations.md) | SQLite via `better-sqlite3` with hand-written forward-only migrations | Accepted, not yet implemented |
| [0005](./0005-packaging.md) | electron-builder for Desktop; bundled Node service and container for Server | Accepted, not yet implemented |
| [0006](./0006-per-worktree-development-state.md) | Per-worktree development state and derived ports | Accepted |
| [0007](./0007-gas-city-compatibility-and-transport.md) | Gas City 1.4.0 pin, supervisor-served OpenAPI, and the adapter transport map | Accepted |
| [0008](./0008-worktree-ownership.md) | Factoru owns worktree lifecycle for the single-task loop | Accepted |
| [0009](./0009-rig-registration-safety.md) | Rig registration requires a clean index and discloses its mutations | Accepted |
| [0010](./0010-agent-tool-transport.md) | Factoru installs its own agent tools from `session_setup_script` | Accepted |

## Writing a new ADR

Copy the structure of an existing record: a `# NNNN — Title` heading, then
**Status**, **Context**, **Decision**, **Consequences**, and **Revisit when**.
Number sequentially and link the ADR from the relevant architecture section.
