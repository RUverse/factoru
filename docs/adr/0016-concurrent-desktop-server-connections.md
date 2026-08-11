# 0016 — Concurrent Desktop server connections

**Status:** Accepted
**Date:** 2026-08-11

## Context

Desktop already persisted multiple server-ID-bound profiles, credentials, cursors,
and caches, but Electron main kept a live socket only for the selected profile.
Switching servers therefore disconnected a healthy local or remote server even
though the product treats servers as durable environments.

## Decision

- Electron main owns one independent authenticated live session, retry timer,
  synchronization lock, cursor, and connection state for every saved server profile.
- All saved profiles connect on Desktop startup. Pairing another server adds its
  session without closing existing sessions.
- One profile remains selected. Its projects and workspace are visible, and all
  renderer commands route only to that selected server; switching selection does
  not open or close healthy sessions.
- Inactive sessions continue receiving bounded events and refreshing only their
  own cached projection. A failure, credential revocation, or removal affects only
  the matching stable server ID.
- Manual SSH preview connections use a distinct Desktop loopback port per server.
  Access transport remains independent from stable server identity.

## Consequences

- Desktop can stay connected to its local server and multiple remote servers at
  the same time without merging their projects or authorization contexts.
- Renderer code still receives no sockets, tokens, or arbitrary transport API.
- Each additional profile consumes one live socket and a small cached projection.
  Server aggregation, cross-server commands, and a merged project view remain out
  of scope.

## Revisit when

Measured client resource use requires connection suspension, or the product adds
an explicit merged cross-server workspace with authorization and command-routing
semantics of its own.
