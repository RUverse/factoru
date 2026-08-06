# 0012 — Generate one city-scoped Project Manager chat identity per project

**Status:** Accepted (Milestone 3)
**Date:** 2026-08-06

## Context

Factoru needs one durable, always-on Project Manager conversation per project,
plus a separate serialized planner. The Factoru project remains rig-scoped, but
Gas City 1.4.0 external-message bindings reject rig-scoped agents. A root-pack
`[[named_session]]` also names a city-scoped template; it cannot be expanded once
per rig.

Factoru nevertheless owns the product identities and model slots. Gas City owns
their concrete agents, sessions, provider processes, and run state. Editing the
portable `factoru-default` pack once per project would mix deployment state into
versioned source and make upgrades unsafe.

Gas City model choice is not an agent `model` field. The supported deployment
surface is a provider reference plus `option_defaults.model`, whose value is
resolved by the selected provider's server-side option schema.

## Decision

Factoru Server projects desired runtime configuration into bounded,
Factoru-managed regions of its dedicated city's configuration:

- each project gets a deterministic city-local chat agent named from its stable
  Factoru project ID;
- the root pack gets one `mode = "always"` named session for that chat agent;
- the imported planner, implementer, and reviewer remain rig-scoped and receive
  per-rig provider and `option_defaults.model` patches;
- chat and planning keep separate Gas City identities even though the desktop
  groups them into one Project Manager Worker Type;
- Factoru writes only its marked regions and generated chat-agent directory,
  structurally adopts its deterministic chat sessions if Gas City's import
  installer normalizes them outside the comment markers, preserves unrelated
  city configuration, writes atomically, refuses symlink traversal, and reloads
  only after a byte change;
- Factoru SQLite remains authoritative for Worker Type/model intent. The city
  files are a recoverable desired-runtime projection.

Provider credentials never enter this projection. They remain in the provider
harness or server-side secret environment. Provider/model identifiers are
validated as data and translated to Gas City fields only inside
`packages/gas-city`.

## Consequences

- External-message bindings survive session replacement because they target a
  stable agent name, while Gas City may replace the live session.
- Projects cannot accidentally share one chat transcript or model binding.
- Removing a project requires a later explicit cleanup policy for its generated
  chat agent and named session; Milestones 3–4 do not delete project state.
- A provider must already be declared in the dedicated city's provider catalog,
  and its option schema must support the selected model. Unsupported bindings
  fail during Gas City reconciliation rather than being converted into shell
  arguments by Factoru.
- Gas City upgrades must re-run the configuration smoke test because named
  session and patch schemas are dependency contracts.
- Import installation may serialize a marked named session as a normal TOML
  table while retaining the original comment-delimited text. Reconciliation
  removes every structurally recognized Factoru chat-session duplicate before
  writing one canonical managed region, so restart and pack upgrades do not
  create duplicate identities.

## Evidence

The generated configuration resolves under Gas City 1.4.0 with a distinct
city-scoped chat agent and a rig-scoped planner/provider patch. Unit tests cover
byte-idempotency, post-import structural adoption, malformed managed blocks,
unsafe identities, and reload suppression. The earlier Milestone 1
external-message probe demonstrated why a
rig-scoped chat target is invalid and why a city-scoped named identity is
required.

## Revisit when

- Gas City supports rig-scoped named external-message identities directly;
- Factoru supports deleting projects and needs a retention/cleanup policy;
- the provider option catalog becomes available through a stable supervisor API
  that can drive a fully curated desktop picker.
