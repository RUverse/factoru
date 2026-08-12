# Milestone 7 implementation and acceptance record

Date: 2026-08-12

## Connected production path

- Protocol v3 adds independently authorized shell, workspace, conversation, and
  run subscriptions with snapshot/replay/live/heartbeat events.
- Factoru Server bounds replay to 500 events, closes a socket above 1 MiB queued
  output, and snapshots only the affected resource after a cursor gap.
- Migration 0008 and `ConversationStore` own durable turns, versioned text/image/
  tool parts, monotonic conversation events, cancellation/failure, authoritative
  final replacement, artifacts, and expiring delivery grants.
- Gas City's adapter uses only the served external-message and provider-neutral
  structured transcript shapes. It forwards image attachments, records the
  target session, maps text/tool/usage projection blocks, ignores thinking, and
  closes the session for cancellation. No tmux/terminal parsing or direct
  provider runtime was added.
- Image bytes cross authenticated HTTP and stay outside SQLite. Server-side
  validation enforces signature/MIME, 8 MiB, 8192px, four images per turn,
  256 MiB per project, scoped reads/writes, retention, and unreferenced cleanup.
- Desktop patches scoped cached resources and provides rich sanitized rendering,
  tools, usage, stop/retry, autoscroll/unread behavior, and picker/paste/drop
  composition with previews, upload state, retry, cancellation, mixed, and
  image-only turns.

## Automated evidence

The repository suites cover protocol validation, migration count/application,
transactional turn lifecycle and late-frame cancellation protection, image
signature/dimension/scoped-grant behavior, recorded Gas City 1.4.0 structured
transcript and attachment shapes, Desktop live-event routing, and shared UI
composer semantics. The full repository entry point is `pnpm check`.

## Operational acceptance attempt

The live matrix was attempted on macOS arm64 with Homebrew Gas City 1.4.0 on
2026-08-12. Both `claude` and `codex` executables were present, but:

1. Claude readiness reported `needs authentication`, so a Claude provider run
   could not be started without user-owned credentials.
2. A fresh Codex-only city could not initialize its bead store. Homebrew had
   selected Dolt 2.2.3 and Beads 1.2.1; Beads stopped with its explicit
   cross-era Dolt-workspace guard before the city started.

The temporary city registrations, launchd supervisor, and neutral temporary
Dolt author identity were removed after the attempt. No provider response or
attachment success is inferred from this failed environment. The remaining
operational exit matrix is:

- start a fresh city with Gas City 1.4.0 and the Factoru-pinned compatible Dolt/
  Beads set;
- authenticate both Claude and Codex harnesses;
- disconnect local and remote Desktop sessions mid-response and verify exact
  text/tool reconciliation without unrelated workspace hydration; and
- exercise accepted/rejected/cancelled/retained image delivery through both
  harness/model configurations.
