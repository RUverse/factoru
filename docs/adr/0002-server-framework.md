# 0002 — Factoru Server framework

**Status:** Accepted (Milestone 0)
**Date:** 2026-08-04

## Context

`docs/ARCHITECTURE.md` lists the server framework as **Validate**. Factoru Server
is a modular monolith that must run on macOS arm64 and Linux arm64/x86_64,
support both a localhost deployment and a remote personal server, stream live
events later, and stay small enough to package as a service or container.

The candidates considered were Fastify, Hono, Express, and NestJS.

## Decision

Use **Fastify 5** as the HTTP server framework.

- It is a plain Node HTTP server with no runtime-specific assumptions, so the
  same artifact runs on every target platform including Raspberry Pi-class
  Linux arm64.
- Its plugin/encapsulation model matches a modular monolith: authentication,
  project scoping, and later live subscriptions become plugins rather than
  middleware chains with implicit ordering.
- `app.inject()` gives full request/response tests without binding a port, which
  keeps route tests fast and hermetic.
- Structured logging (pino) is built in, and the roadmap requires server, project,
  task, run, and command identifiers in logs.
- `@fastify/websocket` covers the live transport when Milestone 2 needs it,
  without changing frameworks.

NestJS was rejected as a large conceptual stack for a single-process personal
server. Express was rejected for weaker typing and no first-class inject/test
story. Hono is attractive but its strengths are edge runtimes Factoru does not
target.

Validation is deliberately **not** delegated to the framework's JSON Schema
layer. Handlers parse requests with the shared Zod schemas from
`packages/protocol` (see [ADR 0003](./0003-api-transport-and-protocol.md)) so
there is one definition of the contract for both sides of the wire.

## Consequences

- Route handlers validate input explicitly and return the shared `Problem`
  envelope, including from the not-found and error handlers, so a client never
  receives an unstructured error.
- Outgoing payloads are parsed with the same schema before they are sent, so the
  server cannot emit something the client would reject.
- The server binds `127.0.0.1` by default; exposing it is an explicit
  configuration change.

## Revisit when

- Live event streaming shows that Fastify's WebSocket integration cannot meet
  the cursor/resume requirements in `docs/ARCHITECTURE.md`.
- Packaging for a target platform requires a runtime Fastify does not support.
