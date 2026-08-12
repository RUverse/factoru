# 0023 — Orchestration projections, task splits, specialist review, and memory trust

**Status:** Accepted, implemented; provider-backed acceptance pending

## Context

Milestone 8 makes Gas City-native execution understandable and recoverable
without turning Gas City's control plane into a public Factoru API. It also
adds PM task splitting and model-proposed memory, both of which need explicit
source-of-truth and trust rules. The serial MVP must keep one admitted task run
and one Factoru-owned capsule even when an implementation decomposes into
several durable units. Review needs independent context without inventing a
third visible Team role or letting reviewers mutate the implementation.

## Decision

- Gas City owns the materialized Formula, convoy, beads, sessions, transcripts,
  and their native cursors. Factoru persists a recoverable, normalized product
  projection plus a separate monotonic stream cursor for each Factoru run.
  Events are the primary update path; authoritative run/workflow/session reads
  rebuild after a gap or restart. Partial reads retain the last complete graph
  and mark it partial or stale.
- Protocol v5 exposes compact run summaries for compatibility and a negotiated
  `orchestration-depth-v1` detail projection. Artifacts are opaque,
  project-authorized handles. Gas City addresses, provider configuration,
  credentials, and server filesystem paths are not projection fields.
- A split is one Factoru transaction: create two through eight ordered Queue
  children, inherit planning/dependency/resource intent, link every child in a
  split audit, redirect downstream dependencies to the last child, and resolve
  the original as `superseded`. `merged_into_task_id` points to the first child
  only as the protocol-v4 compatibility projection; `task_supersessions` is the
  authoritative split relation.
- A clear semantic match between a new request and an existing task appends
  provenance-bearing evidence/scope to that task and records a duplicate
  decision. Uncertain matches and every task-to-task consolidation use the
  existing user-confirmed merge proposal.
- Standard Build drains 2–20 dependency-linked units serially through one
  same-session convoy and one Factoru capsule. Exactly three read-only contexts
  review correctness/testing, security/reliability, and
  maintainability/architecture. They all use the Software Engineer `review`
  binding through distinct Gas City identities/sessions, then fan into a
  separate synthesis session. Only the existing implementation binding applies
  corrections. Trusted checks compare capsule status and commit before/after
  specialists; two verification attempts and six correction attempts are hard
  ceilings.
- Model-written memory is always a pending proposal. Only a user acceptance
  creates an active memory entry. Retrieval is project/role scoped,
  latest-version-only, deterministically ranked, limited to eight entries and
  4 KiB, includes provenance, and is rendered inside explicit
  `untrusted-reference` delimiters. Control characters, foreign references, and
  instruction-like privilege claims are rejected. Relevant accepted memory is
  snapshotted on admitted runs; Gas City beads and artifacts remain the
  current-work handoff.

## Consequences

- SQLite migration 0012 adds normalized run stages, dependencies, units,
  sessions, transcript excerpts, artifacts, reviews, run events, evidence,
  supersession, resource, duplicate-decision, memory-proposal, and run-memory
  tables while preserving coarse historical run JSON.
- Desktop subscribes only to a selected run and shows the detail inside Tasks;
  task cards retain the compact summary.
- Review overlap is the only intra-run overlap. It does not raise global WIP or
  authorize a parallel implementation scheduler.
- Raw artifact bytes remain server-side and require a project/run/artifact
  authorization check.
- Static, recorded-contract, database, server, and Desktop tests support the
  implemented status. The Milestone 8 exit remains open until the real pinned
  provider run/restart/failure/cancellation matrix is recorded.

## Revisit when

- Gas City changes the 1.4 projection/event/session contract;
- Milestone 10 raises admitted task WIP;
- an independently scheduled Formula unit receives its own capsule; or
- a later memory editor needs deletion, redaction, or supersession workflows
  beyond accepted latest-version retrieval.
