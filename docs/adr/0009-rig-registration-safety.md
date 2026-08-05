# 0009 — Rig registration requires a clean index and discloses its mutations

**Status:** Accepted (Milestone 1)
**Date:** 2026-08-05

## Context

`AGENTS.md` states plainly: *preserve user worktrees and unrelated working-tree
changes*. Adding a project is the most ordinary action in Factoru, and it maps
to `gc rig add`.

The Milestone 1 gate tested what `gc rig add` actually does to a repository. It
runs `bd init`, which creates a real commit titled
`bd init: initialize beads issue tracking`.

The test was run twice. On a clean repository it committed only Gas City's own
files. On a repository with a **staged** change, the commit **included the
user's staged file** and left the index empty — the user's work was committed
under Gas City's message, with no prompt and no warning.

An "add project" button that can do that is not shippable.

## Decision

Factoru refuses to register a repository whose Git index is dirty, and always
discloses the full mutation list before registering.

- **Staged changes block registration.** The user is told which paths are
  staged and asked to commit or unstage them first. This is stricter than Gas
  City requires and will occasionally interrupt someone mid-change; the
  alternative is an unrecoverable-by-undo rewrite of their history.
- **Unstaged and untracked files are disclosed, not blocked.** The `bd init`
  commit does not capture them, so blocking would be friction without a
  corresponding risk.
- **The mutation list is shown whether or not registration proceeds**, because
  project setup must preview it and project removal must be able to explain what
  it is deliberately *not* deleting.

Mutations Gas City makes in a registered repository:

- `.beads/` — bead store configuration plus machine-local runtime state
- `.beads/identity.toml` — new, git-tracked, the stable project identity
- `.beads/config.yaml`, `.beads/metadata.json`
- `.gitignore` — appended, ignoring `.beads/*` except `identity.toml`
- one commit: `bd init: initialize beads issue tracking`

Factoru also supplies an explicit bead prefix rather than letting Gas City derive
one, because derivation collides on short names — two rigs named `probe` and
`probe2` both derived the prefix `pr`, and the second registration failed.

Registration is a three-step sequence, in order: `gc rig add`, `gc import
install`, `gc reload`. `gc rig add` writes an import into `city.toml` that is not
yet installed, so a reload between the first and second step fails.

This lives in `packages/gas-city/src/rig-safety.ts` with tests covering the exact
`git status --porcelain` shapes involved.

## Consequences

- Factoru's add-project flow needs a preview step and a blocked state with an
  actionable message. This is a UI requirement from Milestone 2 onward, not a
  detail hidden in the adapter.
- Removing a Factoru project must not delete `.beads/` or revert the commit.
  Gas City's metadata is now part of the user's repository history, and undoing
  it is a rewrite Factoru has no business performing.
- If Gas City later stops committing during `bd init`, the clean-index
  requirement can be relaxed, but the disclosure must stay.

## Revisit when

- Gas City offers a rig registration mode that writes files without committing,
  or an `--adopt` path Factoru can drive for a pre-initialised repository.
