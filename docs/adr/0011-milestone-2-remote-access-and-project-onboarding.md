# 0011 — Milestone 2 remote access and project onboarding

**Status:** Accepted (Milestone 2)
**Date:** 2026-08-06

## Context

Milestone 2 introduces durable projects and the first non-local Desktop/Server
connection. The roadmap fixed the security properties but left the onboarding
surface, initial device authority, repository selection, and externally failing
project setup open.

## Decision

- Factoru Server remains loopback-bound. Milestone 2 remote access uses an
  operator-controlled HTTPS reverse proxy or private overlay. Factoru trusts
  forwarded protocol/client data only when the explicit loopback-proxy setting
  is enabled. Native certificate lifecycle is deferred.
- A server-side `factoru-server pair` command creates a twelve-character,
  ten-minute, one-time code. It is exchanged for a high-entropy revocable
  device token; the desktop stores that token using OS-backed encryption.
- Paired desktops are single-user owner devices with explicit method scopes.
  They can list and revoke trusted devices, including themselves.
- Repository discovery is limited to configured approved roots. Protocol values
  use opaque root IDs plus relative paths; canonical absolute paths stay on the
  server. One canonical repository path may belong to only one Factoru project.
- Project setup previews and revalidates the default branch, index state, and
  Gas City mutations. After confirmation Factoru persists `setting_up` before
  external work, then an outbox reactor reaches `ready` or retryable
  `needs_attention`.
- The desktop keeps a read-only cached project list while offline. Offline
  mutation/conflict semantics are deferred.

## Consequences

- Remote operators must configure HTTPS before pairing; the long-lived token is
  never accepted over remote plaintext HTTP.
- Reverse-proxy setup is operational configuration, not a second server
  architecture. Gas City and Dolt listeners remain host-local.
- Project intent survives ambiguous responses and restarts. Gas City remains
  authoritative for rig runtime, while Factoru remains authoritative for the
  project and desired binding.
- Per-project device grants, viewer roles, native TLS automation, queued offline
  edits, project deletion, and managed local-server launch remain later work.
