# 0015 — Manual SSH forwarding for remote source previews

**Status:** Accepted for developer preview; acceptance pending
**Date:** 2026-08-10

## Context

Factoru Server remains loopback-bound and packaged remote installation is
Milestone 7 work. ADR 0011 selected operator-controlled HTTPS termination for
the first remote product topology, but developers also need a narrow way to run
the current source checkout on a separate Linux machine—including an unvalidated
Raspberry Pi—and connect Desktop without exposing a new listener or managing a
certificate for a temporary test.

Factoru Desktop already accepts plaintext HTTP only for loopback origins. An
SSH local forward can therefore keep HTTP at loopback on both machines while
encrypting and authenticating the network leg.

## Decision

- A manually maintained SSH local forward is an accepted developer-preview
  transport for source deployments. It is not a Factoru SSH adapter, managed
  launch mechanism, or packaged installation feature.
- Factoru Server continues to bind only its derived `127.0.0.1` port. Desktop
  pairs with `http://127.0.0.1:<local-forward-port>`, and SSH forwards that port
  to the exact Factoru loopback listener on the server host.
- `FACTORU_TRUST_PROXY` stays disabled. The SSH daemon is transporting bytes,
  not supplying trusted forwarded HTTP metadata.
- The operator may forward only Factoru Server. Gas City supervisor/controller,
  dashboards, managed cities, agent tools, and Dolt listeners remain host-local
  and must never be forwarded or exposed.
- The canonical runbook is `docs/remote-connection.md`. It targets unprivileged
  single operators on 64-bit Linux arm64/x64 and labels Raspberry Pi and Linux
  arm64 end-to-end behavior unvalidated until real acceptance completes.

## Consequences

- A remote source preview can use the existing authenticated pairing and live
  protocol without weakening the non-loopback HTTPS rule or adding another
  server transport.
- The tunnel must remain alive, its Mac-side port must be free, and the operator
  must rediscover the development server port after restarts that resolve a port
  collision differently.
- tmux keeps the source Server alive across SSH disconnects but does not provide
  startup, update, log rotation, resource limits, or recovery after reboot.
- This path provides no Raspberry Pi support claim. The native SQLite module,
  Gas City dependency chain, provider harnesses, storage growth, and complete
  task loop still require Linux arm64 acceptance.
- Persistent remote operation should continue to use the ADR 0011 HTTPS path
  until Milestone 7 chooses packaged lifecycle and access mechanisms.

## Revisit when

- Factoru ships a packaged Server or a managed SSH access adapter;
- a private-overlay or certificate-managed HTTPS path becomes the default
  remote onboarding experience;
- Linux arm64 acceptance promotes Raspberry Pi from `Validate`; or
- the Desktop transport policy no longer permits loopback HTTP.
