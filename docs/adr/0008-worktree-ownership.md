# 0008 — Factoru owns worktree lifecycle for the single-task loop

**Status:** Accepted (Milestone 1)
**Date:** 2026-08-05

## Context

`docs/ARCHITECTURE.md` recorded a **preferred** capsule ownership split, marked
`Validate`:

> Gas City creates and removes Git worktrees for Formula v2 separate-context
> units and retains its machine-local worktree state; Factoru creates the stable
> capsule record and owns non-Git leases.

with an explicit fallback if the real integration disproved it, and a standing
rule that no lifecycle operation may have two active owners.

The Milestone 1 gate ran a real two-step Formula v2 workflow against a
registered rig. Throughout the run, `git worktree list` reported **only the main
worktree**, and both the implementer and reviewer sessions had `work_dir` set to
the rig's primary repository path.

The assumption was not wrong so much as misattributed. Gas City creates separate
worktrees for **`[steps.drain] context = "separate"` fan-out units**, not for
workflow runs in general. A single-task run with no fan-out gets no worktree at
all, because there is nothing to fan out.

## Decision

For the single-task production loop, **Factoru owns Git worktree creation and
cleanup** and passes the validated path to Gas City as the run's working
directory. Factoru also owns the capsule record and every non-Git lease: ports,
process supervision, service containers, logs, limits, health, retention.

This is the fallback the architecture already named, adopted on evidence. It is
deliberately not a hybrid: one owner for the whole worktree lifecycle.

Concretely:

- Factoru creates a worktree and branch per task run before dispatch.
- The implementer and reviewer steps of one run share that worktree, with
  role-appropriate permissions.
- Factoru removes the worktree on terminal disposition, according to its own
  retention policy, and never with a destructive Git command against a
  user-owned worktree.
- Factoru does not adopt the `drain` fan-out pattern merely to obtain a
  worktree. Using a fan-out construct for one unit of work would buy a worktree
  at the cost of a control-flow shape nobody needs and a second owner for
  cleanup.

## Consequences

- The capsule identity and the worktree have the same owner, which removes the
  hardest part of the original split: correlating a Gas City-created worktree to
  a Factoru lease with no shared transaction.
- Factoru must validate that a repository path is inside a registered project
  root before any worktree operation, since it is now performing them.
- When Milestone 8 introduces real parallelism through `drain` with
  `context = "separate"`, this decision must be re-examined: at that point Gas
  City *would* create worktrees, and having both systems create them is exactly
  the dual ownership the architecture forbids. The likely resolution is that
  drain-based fan-out is adopted together with Gas City worktree ownership, as
  one change, rather than incrementally.
- `bd init` already commits to the registered repository (see
  [ADR 0009](./0009-rig-registration-safety.md)). Factoru performing worktree
  operations in the same repository makes the "preserve user work" obligation
  stricter, not looser.

## Revisit when

- Milestone 8 adopts `drain` fan-out for parallel task runs.
- Gas City exposes worktree lifecycle as a first-class, addressable operation
  for non-drain workflow runs.
