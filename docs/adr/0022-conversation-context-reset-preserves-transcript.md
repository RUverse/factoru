# 0022 — Conversation context reset preserves the Factoru transcript

**Status:** Accepted, implemented

## Context

Project Manager chat is both an auditable Factoru record and input to a durable
Gas City-managed provider session. A user sometimes needs the agent to stop
carrying earlier chat turns without deleting the record of what happened,
changing durable project/role memory, or creating a parallel provider runtime.

Deleting messages would weaken audit and recovery. Merely hiding them in
Desktop would leave the provider session's context intact. Reusing the same Gas
City external-message conversation after closing a session would also make late
callbacks and transcript replay ambiguous.

## Decision

- Factoru exposes one authenticated, idempotent `conversations.resetContext`
  command. It is rejected while a conversation turn is active.
- The server closes the latest Gas City provider session through
  `packages/gas-city`. Only after that succeeds does it rotate the external
  conversation identity, reset its Gas City transcript cursor, increment a
  durable context revision, and emit a scoped `context.reset` event.
- Factoru messages and turns are never deleted. Each context revision is a
  durable chat-history entry, including an empty chat. Every new turn/message
  is stamped with that revision, and bounded history queries default to the
  current chat or explicitly select one archived revision.
- Desktop asks for confirmation, explains that project memory and tasks are
  unchanged, opens a clean current chat, and restores focus to the initiating
  control. Earlier chats remain selectable from a dated history control and
  render read-only with independent pagination.
- The stable Factoru conversation ID remains unchanged. Only the Gas City
  external-message identity rotates, so project ownership, artifact scope, and
  Desktop subscriptions do not change.

## Consequences

- A reset ends provider-session context and cannot reconstruct that provider's
  hidden state, but the full user-visible transcript remains available.
- Late callbacks carrying the old external conversation identity fail the
  existing project/conversation scope check instead of entering the new context.
- If Gas City cannot close the prior session, Factoru does not advance the
  revision and reports the failure; it never claims a clean context based only
  on a UI change.
- Durable project and role memory is intentionally independent and continues to
  apply after a chat-context reset.
- Current workspace projections contain only the current revision, avoiding
  accidental retransmission or unbounded renderer hydration; archived chats are
  loaded on demand from the same authoritative Factoru transcript.

## Revisit when

Gas City offers a native, durable conversation-fork/reset operation with stronger
atomicity than close-plus-identity-rotation, or the product adds named parallel
conversation threads within one project.
