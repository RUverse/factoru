# 0019 — Project Blueprints, Formula Presets, and the Project Manager boundary

**Status:** Accepted, implemented; Standard Build provider acceptance pending
**Date:** 2026-08-12

## Context

Factoru originally exposed one built-in Factory Template and bound every
admitted software task to the local `software-delivery` formula. That kept the
first vertical slice small, but it conflated the reusable project setup, the
user-facing workflow choice, and the Gas City formula that performs the work.
It also left no safe way to reuse Gas City's richer `gc.build-basic` lifecycle
without replacing the proven bounded patch path.

The Factoru Project Manager is the user's coordinator and therefore resembles
Gas City's Mayor. The upstream Mayor, however, may create beads and launch work
directly. Giving that unrestricted skill to the Factoru Project Manager would
bypass Factoru's authoritative project, task, admission, capability, and audit
boundaries.

## Decision

- A **Project Blueprint** is the versioned project-starting bundle. It declares
  fixed Team role profiles, pinned packs, allowed Formula Presets, a recommended
  default, and capacity policy. `Standard Software Project` is the recommended
  default; `Fast Patch` is an immediately selectable alternative.
- A **Formula Preset** is Factoru's validated user-facing configuration of a
  Gas City Formula: pinned pack/formula, variables, Team model bindings,
  capabilities, limits, and launch mode. A Formula remains the Gas City workflow
  itself.
- Workflow selection resolves Blueprint seed → project default → task choice.
  A user-locked task choice wins. During Queue reconciliation, the Project
  Manager may select another preset from the Blueprint allowlist only while the
  task remains unlocked. Admission records an immutable run snapshot containing
  the preset and Blueprint versions, formula name/hash, resolved variables,
  pack-lock digest, and Gas City correlation identifiers.
- `standard-build` is a thin Factoru Formula v2 overlay on the pinned upstream
  `gc.build-basic`. It preserves requirements, design, decomposition,
  implementation, review, and finalization, while binding work to the
  Factoru-owned capsule, limiting the serial drain to 20 units, and inserting a
  trusted Factoru verification/correction step before upstream review. It uses
  an `attached` launch: Factoru idempotently creates a source bead with
  task/run/capsule metadata, previews inherited resolution at rig scope, then
  attaches and slings the formula.
- `fast-patch` continues to use the existing, unchanged `software-delivery`
  formula with its implement → check → review → finalize path and two-attempt
  correction bound. It uses the existing `standalone`, targetless launch.
- Both presets run at WIP one in the Factoru-owned task capsule. Standard Build
  uses the upstream same-session/shared drain. Separate Gas City worktrees,
  interactive gates, parallel workers, and automatic push or pull-request
  creation remain out of scope.
- The visible product profiles are **Team** roles. The initial fixed roles stay
  Project Manager and Software Engineer. Software Engineer has `design`,
  `implementation`, and `review` model slots; migration initializes `design`
  from the former Project Manager planning binding.
- Factoru's Project Manager remains the Mayor-equivalent coordinator, but it is
  not bound to an upstream `gc.mayor` agent or unrestricted Mayor skill. It may
  coordinate only through authenticated, role-scoped Factoru tools; Factoru
  Server alone admits and schedules execution.
- Protocol v2 exposes the Blueprint, Team, and Formula Preset catalog. The old
  Factory Template and Worker Type fields remain read-only compatibility aliases
  for protocol v2 and are not a second mutable product model.

## Consequences

- New projects have a strong, production-shaped default while users can retain
  the faster bounded workflow at either project or task scope.
- Changing a project default cannot rewrite an admitted or active run, and PM
  planning cannot silently override an explicit user choice.
- Factoru reuses the pinned upstream build lifecycle and roles instead of
  copying them, while its small overlay keeps verification, capsule ownership,
  limits, and publishing policy under Factoru control.
- The pack imports both the upstream roles subpack and the complete workflow
  pack at the pinned SHA. These imports are trusted executable configuration;
  arbitrary user imports remain deferred.
- Attached launch adds one durable source bead and one more recovery
  correlation. Bead creation is idempotent, and a failed rig-scope formula
  preview occurs before that durable mutation.
- Existing active runs keep their captured `software-delivery` behavior.
  Unlocked queued tasks migrate to Standard Build, while explicit choices remain
  intact.
- Standard Build is connected and adapter-tested but remains **Partial** until
  the pinned Gas City executable and a real provider complete failure,
  correction, restart, responsiveness, and source-checkout safety acceptance.

## Revisit when

- project concurrency makes separate-session drains or Gas City-owned
  worktrees desirable;
- arbitrary Blueprint, pack, or Formula imports receive an explicit trust and
  signing model;
- a later protocol version can remove the compatibility aliases;
- additional Team roles or Formula Presets are justified by measured usage; or
- the upstream build formula changes enough that the overlay or capability
  policy must be revised.
