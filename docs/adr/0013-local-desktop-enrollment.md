# 0013 — Same-machine desktop enrollment uses a private restart-scoped proof

**Status:** Accepted
**Date:** 2026-08-06

## Context

Factoru has one client/server architecture whether Desktop and Server run on
different machines or on the same machine. Remote enrollment requires an
operator-created, short-lived pairing code. Requiring that same ceremony after
the user chooses **This device** is misleading and adds no useful confirmation:
the operator is already asking the local Desktop to trust the local Server.

Removing authentication from localhost is not acceptable. Any local process
could otherwise mint an owner device credential. Sending a bootstrap secret
through the renderer is also not acceptable because the renderer is the
untrusted UI boundary.

## Decision

On normal startup, Factoru Server writes a schema-versioned enrollment
descriptor beside its server state. It contains the stable server identity, the
exact loopback origin, and a new random 256-bit proof for that process start.
The file is written as a regular `0600` file and is treated as a same-OS-user
capability rather than product state.

Electron main—not the renderer—reads and validates the configured file. It
checks that the descriptor is private, regular, loopback-only, and identifies
the server returned by the normal protocol handshake. It then exchanges the
proof through a dedicated loopback-only endpoint for the same revocable,
server-ID-bound owner device credential used by remote pairing. The proof and
file path never cross preload into renderer state.

Development harnesses give Server and Desktop the same per-worktree enrollment
file path. Packaged local service discovery and lifecycle management remain a
Milestone 7 responsibility; this decision defines the authentication mechanism
that lifecycle will use.

## Consequences

- **This device** needs only a device name and one connect action. It never asks
  for a server address or one-time pairing code.
- **Remote server** keeps the explicit HTTPS address and one-time code flow.
- Local enrollment trusts processes running as the same OS user that can read
  the private proof. It does not claim isolation from that user or from a
  compromised account.
- The proof rotates on every Server start. A stale descriptor cannot enroll
  against a restarted process, and the resulting long-lived token remains
  revocable through the normal trusted-device model.
- The server advertises local enrollment as a negotiated capability. Older
  servers fail with an actionable compatibility message instead of silently
  falling back to unauthenticated localhost access.
