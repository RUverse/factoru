# 0003 — API transport and protocol contract

**Status:** Accepted (Milestone 0); live transport deferred to Milestone 2
**Date:** 2026-08-04

## Context

Desktop and server may be updated at different times, so compatibility must be
negotiated rather than inferred. `docs/ARCHITECTURE.md` requires runtime schema
validation on both sides, a `server_id`/version/capability handshake, structured
errors that separate retryable transport failures from blocked states, and later
durable subscriptions with cursors.

T3 Code's Effect RPC stack solves these problems but introduces a large
conceptual dependency. The roadmap says to adopt the principle, not the stack.

## Decision

**Milestone 0 transport:** plain HTTP with JSON bodies under a versioned prefix.

```text
GET  /api/v1/health      → HealthResponse
POST /api/v1/handshake   → HandshakeResponse
```

**Contract:** `packages/protocol` owns Zod schemas, the protocol version
constants, the compatibility rule, the `Problem` error envelope, and a typed
client. Both applications validate at runtime with the same schemas; TypeScript
types are inferred from them, so a schema change cannot silently pass typecheck
on one side only.

**Versioning:** each peer advertises the newest protocol version it speaks and
the oldest it accepts. `checkCompatibility` negotiates the highest shared
version and otherwise reports `server_too_old` or `client_too_old` with a
message that says which side to update. Capabilities are a separate string list
so additive server features do not require a protocol bump.

**Trust:** the client re-runs the compatibility check against its own range
instead of believing the server's `compatible` flag. A server that wrongly claims
compatibility is still rejected, which is covered by tests on both sides.

**Errors:** every non-2xx response carries `{ error: { code, message, details? } }`.
The client maps unknown or unstructured failures to `invalid_response` and
network/timeout failures to `transport_error`/`timeout`, which are the only
codes it treats as retryable.

**Deferred:** live subscriptions, pairing, and authentication. They land in
Milestone 2 and are expected to use a WebSocket connection carrying the same
schema definitions, with a short-lived connection ticket rather than a
long-lived token in the URL.

## Consequences

- Adding an operation means adding a schema, a route, and a client method in one
  package, with tests that exercise the same schema from both directions.
- The desktop's connection runtime distinguishes "cannot reach" from "will never
  work", which is what the connection state machine needs.
- A raw HTTP surface means no code generation step and no transport-specific
  types leaking into the domain.

## Revisit when

- Live subscriptions need ordering, backpressure, or resume semantics that ad-hoc
  WebSocket handling makes error-prone — then evaluate a typed RPC library
  against this contract rather than replacing it wholesale.
