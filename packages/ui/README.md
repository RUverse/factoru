# `@factoru/ui`

Factoru's framework-level visual foundation for desktop product surfaces. It
contains semantic system-theme tokens, owned component CSS, and compiled React
primitives. It deliberately contains no transport, Electron, filesystem,
database, orchestration, or product-state logic.

## Public exports

The package root exports:

- `Button`, `IconButton`, `Badge`, `Card`, and `Field` for common controls and
  surfaces;
- accessible `Tabs`, `Dialog`, `Drawer`, and `Tooltip` composites built on Base
  UI behavior;
- `EmptyState`, `SplitView`, and `ResizeHandle` layout primitives; and
- the controlled, autosizing `PromptComposer`, including Enter/Shift+Enter/IME
  behavior, attachment/stop callbacks, image-only submission enablement, and
  optional action slots.

Import `@factoru/ui/styles.css` once at the renderer entry point. The stylesheet
includes the token layer. The legacy `@factoru/ui/tokens.css` export remains
available for token-only consumers.

React and React DOM are peer dependencies so the renderer owns the runtime.
Lucide provides the icon grammar, while all colors, spacing, typography,
surfaces, borders, focus, motion, and status treatments stay in Factoru CSS.
Light and dark values follow the operating system through
`prefers-color-scheme`; reduced-motion tokens and component transitions honor
`prefers-reduced-motion`.

See [ADR 0020](../../docs/adr/0020-desktop-shell-and-ui-foundation.md) for the
desktop-shell and component-boundary decision.
