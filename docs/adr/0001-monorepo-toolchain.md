# 0001 — Monorepo toolchain

**Status:** Accepted (Milestone 0)
**Date:** 2026-08-04

## Context

Factoru is one repository containing two independently deployable applications
and several shared packages. The roadmap names pnpm workspaces, TypeScript,
Electron, and React as the intended starting toolchain, and requires that
formatting, linting, typechecking, unit tests, and CI exist before feature work.

The repository must also enforce the package boundaries in `AGENTS.md`. Boundary
rules that live only in prose decay.

## Decision

- **Package manager:** pnpm workspaces, pinned through `packageManager` in the
  root manifest. Workspace globs cover `apps/*`, `packages/*`, `packs/*`, and
  `templates/*`.
- **Language and module system:** TypeScript 5.9 targeting Node 22 LTS. Shared
  packages are ESM with `NodeNext` resolution and are consumed from their build
  output through the `exports` field. `apps/desktop` is bundled by electron-vite
  and therefore compiles with `bundler` resolution.
- **Shared compiler options** live in `packages/config`. Each package sets only
  its own `rootDir`/`outDir`, because TypeScript resolves paths in an extended
  config relative to the file that declares them.
- **Formatting:** Prettier, with `docs/` excluded because those documents are
  hand-authored prose whose tables Prettier would churn.
- **Linting:** ESLint 10 flat config with `typescript-eslint`. The package
  boundaries from `AGENTS.md` are encoded as `no-restricted-imports` rules, so
  `packages/domain` importing Electron, React, a database driver, or Gas City
  fails `pnpm lint`, as does the renderer importing Node.js or Electron.
- **Tests:** Vitest per package. The development scripts under `scripts/` are
  plain ESM and are tested with Node's built-in test runner, which keeps the
  repository root free of a test framework dependency.
- **Canonical commands** are the same locally and in CI:
  `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`,
  and `pnpm check` (all of them).

Packages are only created when they have real content. `packages/database`,
`packages/gas-city`, `packages/ui`, `packs/`, and `templates/` exist as
directories with a README naming the milestone that introduces them; they have
no package manifest, so nothing implies capability that does not exist.

## Consequences

- Shared packages must be built before dependents typecheck. `pnpm typecheck`
  runs `pnpm build` first, and `pnpm dev` builds the shared packages before
  starting the watchers.
- A boundary violation is a lint failure with a message that explains the rule,
  rather than a review comment.
- Adding a package means adding its manifest, its `tsconfig.json` extending
  `@factoru/config`, and its `build`/`typecheck`/`test` scripts. `pnpm -r`
  handles ordering.

## Revisit when

- Build times make per-package `tsc` runs uncomfortable — then evaluate project
  references or a build orchestrator, not a different package manager.
- A second consumer needs a shared package that currently exists only as a
  placeholder directory.
