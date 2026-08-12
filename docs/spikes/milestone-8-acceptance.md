# Milestone 8 acceptance report

Date: 2026-08-12
Status: **implementation connected; live exit gate open**

## Scope under test

Milestone 8 keeps global autonomous WIP at one and one Factoru-owned capsule per
run. Standard Build materializes 2–20 dependency-linked units and drains them
serially in the same implementation session. Only the three fixed read-only
specialist contexts may overlap; their reports feed a separate synthesis
session, and corrections return to the existing implementation binding. The
deterministic verification budget is two attempts and the correction budget is
six.

The connected product path includes protocol v5 and
`orchestration-depth-v1`, migration 0012, normalized recoverable run state,
independent resumable cursors, opaque artifact reads, task evidence/split/
resource intent, approval-gated memory proposals, Gas City 1.4.0 native DTO
parsing, the expanded default pack, role-scoped tools, and the selected-run
Desktop inspector.

## Automated evidence

- The repository pre-change baseline passed `pnpm check`.
- Protocol tests cover v5 detail, bounds, resource intent, memory, and
  redaction-facing schemas.
- Database tests cover migration/backfill, atomic split rollback,
  supersession/dependency behavior, resource validation, evidence and duplicate
  audit persistence, memory approval/rejection/bounds/poisoning defenses,
  last-complete projection retention, and WIP-one behavior.
- Recorded Gas City 1.4.0 contract fixtures cover Formula preview, native
  workflow/convoy projection, structured bounded transcripts, usage/cost,
  partial responses, unknown statuses, cursor replay/gaps, cancellation, and
  restart-reconstructible reads.
- Pack assertions cover one shared capsule, a single-lane same-session convoy,
  exactly three specialist lanes plus synthesis, fixed retry ceilings,
  versioned schemas, disabled publishing, and trusted pre/post-review mutation
  checks. `gc lint ./packs/factoru-default --json` passes under Gas City 1.4.0.
- Server and Desktop suites cover persisted event-driven detail, scoped replay
  and fallback, terminal protections, artifact authorization, role tools,
  selected-run subscription lifecycle, detail rendering, bounded evidence,
  actions, focus/keyboard behavior, narrow layouts, and reduced motion.

The final aggregate `pnpm check` passed on 2026-08-12: formatting, production
build, type checking, lint, 500 Vitest cases (domain 35, protocol 61, Gas City
105, UI 8, database 80, Desktop 78, Server 133), and 33 script tests all passed
for 533 automated tests total.

## Live environment audit

The available machine reported:

| Component | Observed | Accepted Milestone 8 set | Result |
| --- | --- | --- | --- |
| Gas City | 1.4.0 | 1.4.0 | compatible |
| Beads | 1.2.1 | 1.1.2 | compatibility decision required |
| Dolt | 2.2.3 | 2.1.7 | compatibility decision required |
| Codex harness | authenticated with ChatGPT | configured provider | available |
| Claude harness | not authenticated | configured provider for selected matrix | unavailable |

The plan explicitly forbids silently changing the pinned compatibility set.
Consequently, no disposable-city run was presented as acceptance evidence and
no system dependency was downgraded or upgraded. Existing source checkouts and
unrelated cities were not modified.

## Remaining live exit matrix

With an explicitly approved compatible Beads/Dolt set and both selected
provider bindings:

1. Complete a nontrivial Standard Build with at least three durable units, all
   three specialist reports, synthesis, trusted checks, and usage/cost.
2. Restart Factoru Server mid-run and verify exact projection, cursor, and
   session recovery from authoritative native reads.
3. Force one deterministic verification failure and prove bounded correction,
   re-check, and complete review-subtree replay.
4. In a separate run, cancel mid-execution and prove terminal cancellation with
   no later work or terminal-state regression.
5. Verify the source checkout remains unchanged and Desktop receives no raw Gas
   City configuration, provider secret, session identity, or server filesystem
   path.

Milestone 8 must remain open until this matrix passes and the resulting evidence
is appended here.
