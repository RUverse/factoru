# 0021 — Scoped streams over the existing authenticated WebSocket

**Status:** Accepted, implemented
**Date:** 2026-08-12

## Context

Milestone 7 requires independently resumable shell, workspace, conversation,
and run resources. The Delivered Foundation already had one authenticated,
supervised WebSocket per factory, shared Zod validation, one-time connection
tickets, method authorization, command receipts, and reconnect ownership in
Desktop. Its only push shape was too coarse: a generic project event caused a
project-list and active-workspace refetch.

The focused transport spike compared extending that connection with adding a
small typed streaming-RPC library. A second transport would still need to share
the existing ticket, authorization, cursor, reconnect, cancellation, and
backpressure policy. It would also create two live-session owners during the
most failure-sensitive milestone. Effect RPC was considered only as one example
of that alternative; Factoru otherwise has no Effect runtime or schema stack.

## Decision

- Retain one authenticated WebSocket per connected factory and extend protocol
  v3 with `streams.subscribe` and `streams.unsubscribe`.
- A subscription names one bounded resource: shell, workspace, conversation, or
  run. Server authorization occurs on the subscription request and resource
  identifiers are revalidated against Factoru ownership.
- Every resource emits a typed snapshot when initially hydrated or when its
  cursor falls outside the 500-event replay window. In-window reconnects emit
  ordered deltas followed by an explicit `stream.live` marker.
- Global resources use the Factoru domain-event cursor. Conversations use their
  own durable stream-event sequence so token/tool updates cannot force unrelated
  workspace hydration. Historical messages use a separate bounded pagination
  query.
- The server emits a heartbeat every 15 seconds. A socket with more than 1 MiB
  queued output is closed with retryable overload semantics rather than growing
  an unbounded buffer. A replay over 500 events falls back to only the affected
  resource snapshot.
- Desktop patches its per-factory cache from scoped snapshot/delta payloads.
  Older servers retain the protocol-v2 generic event/refetch compatibility path;
  protocol-v3 peers do not use that path for steady-state updates.
- Binary image bytes remain on authenticated HTTP routes. The WebSocket carries
  opaque artifact metadata and content parts only.

## Consequences

- Factoru has one connection, reconnect loop, authentication mechanism, and
  runtime schema family rather than parallel live stacks.
- Conversation text/tool projections can update frequently without refetching a
  whole workspace, while the final durable message remains authoritative.
- Snapshot payloads are intentionally complete for one resource. Fine-grained
  patch compression may be added from measured pressure without changing the
  cursor or source-of-truth contract.
- The existing project subscription remains a negotiated compatibility surface,
  not the protocol-v3 synchronization architecture.

## Revisit when

- measured stream volume cannot stay within the replay and backpressure bounds;
- more than one server process must fan out the same live subscriptions;
- a typed RPC library removes substantial protocol code while preserving one
  connection and the existing trust boundaries; or
- protocol-v2 compatibility can be removed through an explicit version change.
