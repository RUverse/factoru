# Milestones 5 and 6 acceptance

Date: 2026-08-06  
Host: macOS arm64  
Gas City: 1.4.0  
Pack: `factoru-default` 0.3.0  
Formula hash: `5c1ac19927e7ee14865fe11cf423c6c0e707f7ce6cf01a7e84f3aefa02cde7fb`

## Milestone 5 result

The opt-in `scripts/milestone-5-acceptance.mjs` harness ran the real adapter,
SQLite stores, capsule service, Gas City workflow, configured Codex provider,
trusted checks, separate reviewer, finalizer, and Factoru review transition in
a disposable repository.

- 10 tasks attempted; 10 accepted without changes (100%).
- Every deterministic check passed and every independent review approved.
- Median end-to-end run duration was 719.5 seconds; the range was 629–1,746
  seconds. Evidence adjudication was immediate and comfortably below ten
  minutes, though this is an operator benchmark rather than a UX study.
- 556,346 input and 158,563 output tokens were observed across the ten runs.
- Gas City 1.4.0 did not emit priced operation facts for these autonomous Codex
  pool sessions. Factoru recovered normalized token counts from Gas City's
  structured transcript and displayed pricing as `unpriced`; it did not claim
  that the dollar cost was zero.
- The source repository retained the same commit and had no unexpected working
  tree changes. Gas City's reviewed runtime metadata remained the only expected
  repository-local state.
- The run was observed across a Factoru service reconstruction, a longer
  Factoru outage while Gas City continued, a duplicate reactor pass, and a
  Gas City soft configuration reload. Durable workflow-root, event-cursor,
  capsule, formula-hash, and task-run correlation recovered correctly.

Strict Formula validation, replay/deduplication, cancellation state,
transient-dispatch retry, bounded failure/retry, exhausted-run recovery, dirty
capsules, and conflicts also have deterministic regression coverage. The live
benchmark exercised the successful provider path and restart/adoption path;
Linux and packaged-host coverage remains a Milestone 7 acceptance item.

## Milestone 6 result

A real Project Manager chat turn requested `Add catalog task-11`. The PM used
its project-scoped audited tools in this order: duplicate search, create,
update, queue, and final planning update. Factoru then admitted one ready task
under WIP one without direct board manipulation.

The server application service was reconstructed after dispatch. The same Gas
City run resumed and completed implementation, deterministic checks,
independent review, and final evidence in one capsule. Factoru produced a
Needs-you package with the exact request, plan, two-file diff, commit, passing
checks, an `APPROVE` review with specific verification notes, no unresolved
risks, and 63,498 input / 17,447 output tokens marked `unpriced`. The operator
accepted it without changes. The disposable source repository again retained
its original head and clean application files.

This proves the Milestone 6 product path from conversation to reviewed diff and
restart adoption. Full Electron process launch, supervisor-wide restart, and
agent-process fault injection are not repeated here because they would disturb
the shared development supervisor; their protocol/state behavior remains
covered at the narrow layers, while packaged lifecycle drills belong to
Milestone 7.
