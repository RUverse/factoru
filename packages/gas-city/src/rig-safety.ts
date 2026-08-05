/**
 * Preconditions Factoru enforces before it lets Gas City register a repository
 * as a rig.
 *
 * This exists because of a behaviour observed against Gas City 1.4.0 during the
 * Milestone 1 gate, reproduced deliberately on a disposable repository:
 *
 *   `gc rig add <path>` runs `bd init`, which creates a **real git commit** in
 *   the target repository ("bd init: initialize beads issue tracking"). That
 *   commit is produced with `git add` semantics that sweep up whatever is
 *   already staged. A user with a staged change had it committed under Gas
 *   City's message, and their index was left empty.
 *
 * Factoru's product invariant is that it preserves user worktrees and unrelated
 * working-tree changes, so it cannot expose an "add project" button that can do
 * that. The mitigation is a precondition, not a workaround: refuse to register
 * a repository whose index is dirty, and tell the user exactly what Gas City is
 * about to write. Unstaged and untracked files are left alone by the commit, so
 * they only warrant disclosure.
 */

/** One path in the repository's status, in the shape Factoru needs to judge it. */
export interface RepositoryStatusEntry {
  readonly path: string
  /** Whether the path has changes in the index (would be swept into a commit). */
  readonly staged: boolean
}

export interface RigRegistrationPreview {
  /** Whether Factoru may proceed with registration. */
  readonly safe: boolean
  /** Staged paths that would be captured by Gas City's commit. */
  readonly stagedPaths: readonly string[]
  /**
   * What Gas City will write into the repository. Shown to the user before
   * registration so the mutation is never a surprise, and so project removal
   * can explain what it is not deleting.
   */
  readonly repositoryMutations: readonly string[]
  /** Why registration is blocked, when it is. */
  readonly blockedReason: string | undefined
}

/**
 * Paths Gas City creates or modifies in a registered repository, observed on
 * 1.4.0. `.beads/identity.toml` is intended to be committed by the user;
 * everything else under `.beads/` is ignored by the `.gitignore` rules Gas City
 * appends.
 */
export const GAS_CITY_REPOSITORY_MUTATIONS: readonly string[] = [
  '.beads/ (new directory: bead store configuration and local runtime state)',
  '.beads/identity.toml (new, git-tracked: the stable project identity)',
  '.beads/config.yaml, .beads/metadata.json (new: bead store and Dolt endpoint configuration)',
  '.gitignore (appended: ignores .beads/ except identity.toml)',
  'one git commit: "bd init: initialize beads issue tracking"',
]

/**
 * Decide whether a repository is safe to register.
 *
 * A clean index is required. This is stricter than Gas City needs and it will
 * occasionally inconvenience someone mid-change, but the alternative is a
 * product that silently commits a user's staged work under someone else's
 * message — which is not recoverable by an undo button, only by git surgery.
 */
export function previewRigRegistration(
  status: readonly RepositoryStatusEntry[],
): RigRegistrationPreview {
  const stagedPaths = status.filter((entry) => entry.staged).map((entry) => entry.path)

  if (stagedPaths.length > 0) {
    return {
      safe: false,
      stagedPaths,
      repositoryMutations: GAS_CITY_REPOSITORY_MUTATIONS,
      blockedReason:
        `Registering this repository makes Gas City create a commit, and it would capture ${stagedPaths.length} ` +
        `staged change${stagedPaths.length === 1 ? '' : 's'} under its own message. ` +
        'Commit or unstage them first, then register the project.',
    }
  }

  return {
    safe: true,
    stagedPaths: [],
    repositoryMutations: GAS_CITY_REPOSITORY_MUTATIONS,
    blockedReason: undefined,
  }
}

/**
 * Parse `git status --porcelain` output into status entries.
 *
 * Porcelain v1 format: two status characters, a space, then the path. The first
 * character is the index status and the second the working-tree status, so a
 * path is staged when the first character is neither a space nor `?`.
 */
export function parsePorcelainStatus(output: string): RepositoryStatusEntry[] {
  return output
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => {
      const indexStatus = line[0]!
      let path = line.slice(3)

      // A rename is reported as `R  old -> new`; the new path is what exists.
      const renameSeparator = path.indexOf(' -> ')
      if (renameSeparator !== -1) path = path.slice(renameSeparator + 4)

      return { path, staged: indexStatus !== ' ' && indexStatus !== '?' }
    })
}
