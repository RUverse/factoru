# 0020 — Frameless desktop shell and shared UI foundation

**Status:** Accepted, implemented
**Date:** 2026-08-12

## Context

Factoru Desktop's first working product slice used Electron's native title bar,
a fixed three-column renderer grid, dark-only CSS tokens, and one large renderer
component. That was sufficient to validate the server-backed workflows, but it
did not provide a durable desktop layout foundation. Narrow windows compressed
the conversation, pane sizes could not be adjusted or remembered, and common
controls had no accessible shared implementation.

T3 Code and Codex demonstrate useful separation between privileged desktop
window behavior, unprivileged presentation state, and product state. Beautiful
UI demonstrates the compact, rounded prompt-composer treatment that fits an
agent conversation. These are references only: Factoru retains its own product
identity, workflows, source-of-truth rules, and owned CSS.

## Decision

- Electron uses a hidden title bar while retaining native window controls.
  macOS uses explicitly positioned traffic lights; Windows and Linux use the native title-bar
  overlay. A 48px renderer header is the drag region, while every interactive
  element is explicitly non-draggable. The default window is 1280×820 and the
  compact minimum remains 720×480.
- Electron follows `nativeTheme` live for the window background and native
  overlay symbols. Renderer tokens use `prefers-color-scheme`; Factoru does not
  add a second manual theme preference.
- The preload allowlist adds only platform identity, the current fullscreen
  state, and a cleanup-safe fullscreen subscription. Raw IPC, arbitrary window
  commands, and Node access remain unavailable to the renderer.
- One exported renderer layout policy owns pane defaults, limits, the 480px
  conversation minimum, and derived responsive thresholds. Sidebar width,
  inspector width, and explicit sidebar collapse are stored in a versioned
  renderer-local preference. They are presentation state, not product state,
  and may be discarded and reconstructed without affecting Server data.
- Wide windows render inline resizable panes. The sidebar becomes a drawer when
  the three minimum panes no longer fit; the inspector also becomes a drawer
  when its minimum and the conversation minimum no longer fit. Automatic drawer
  selection never rewrites the explicit collapse preference.
- `@factoru/ui` owns semantic system-theme tokens, base component CSS, and React
  primitives. React and React DOM are peers; Base UI supplies behavior for
  accessibility-heavy composites, Lucide supplies icons, and Factoru continues
  to own all visual styling. No utility-CSS framework or pre-styled design
  system is introduced.
- The composer is a controlled shared component with autosizing, Enter/Shift+
  Enter/IME semantics, disabled future affordances, and optional action slots.
  It submits through the existing typed command and renders only authoritative
  persisted messages. Streaming remains later work.
- Renderer layout, responsive-pane, window-state, and shared-component modules
  are separated from the product controller. Transport, retries, credentials,
  filesystem operations, and Server concerns remain outside visual components.

## Consequences

- Native controls and a frameless visual shell coexist without Factoru owning
  close, minimize, or maximize behavior.
- Pane sizing is deterministic, testable, keyboard operable, and cannot consume
  the conversation's minimum width. The compact 720px window uses drawers
  instead of forcing horizontal workspace management.
- Shared components now have a compile step and jsdom tests. Desktop builds must
  build `@factoru/ui` first, which the workspace build order already guarantees.
- Base UI, Lucide, React, and React DOM are UI-package dependencies/peers only;
  they do not cross into domain, protocol, database, or orchestration packages.
- Disabled composer affordances communicate intended extension points without
  pretending attachments, model switching, dictation, stop generation, or
  streaming exist.

## Revisit when

- Linux packaging reveals a compositor that cannot support the native title-bar
  overlay safely;
- a user-selectable theme is justified and can remain renderer-local;
- a second persisted layout schema requires migration rather than reset; or
- streaming/tool/attachment protocol work needs new composer slots or message
  items without replacing the shell.
