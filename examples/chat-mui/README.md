# Chat with Material UI

This is a real Chat template app wired to Material UI 9 through the
`@agent-native/toolkit/design-system` contract. The complete adapter is in
[`app/design-system.tsx`](app/design-system.tsx); it is intentionally the
smallest useful reference for a CSS-in-JS design system with its own
ThemeProvider and overlay stack.

## What is bridged

All 17 contract components are registered. In the shipped Chat surfaces, 16/17
currently render through the registered Material UI adapters:

- `ActionButton`/`IconButton`: chat-history rail and shared actions.
- `TextField`/`TextArea`/`Picker`/`Checkbox`/`Switch`/`Tabs`: settings and
  sharing controls.
- `Dialog`/`Avatar`/`Status`: the sharing dialog.
- `Tooltip`/`Popover`/`Spinner`/`Skeleton`: agent-panel and sidebar chrome.
- `Surface`: the Builder connection card.

`Menu` is the one explicit gap. The agent-panel header menu still owns a live
`RunsTrayMenuItem` compound submenu whose arbitrary run rows cannot be expressed
by the v1 data-only `Menu` contract, so it remains Radix-owned. This is a known
gap, not a claim that every visible control is MUI-backed. The assistant-ui
composer/message renderer, cmdk command-menu internals, and Tiptap editor are
also v1 non-goals; their surrounding chrome is bridged or tokenized.

Material UI's light and dark themes are selected from `next-themes`, while the
same `theme` export is passed to the Core Vite plugin for build-time CSS tokens.
No runtime or request-specific theme CSS is generated.

The example maps Material UI's generated palette and typography into the
build-time theme. The body exposes Material UI's default Roboto stack through
`--font-family`; deployments that want the exact Roboto face should load it
through their normal font pipeline.

The framework-owned sign-in page is outside the design-system bridge. Use the
authenticated settings, sharing, chat-history, and agent-panel surfaces when
comparing the Material UI adapter with another adapter.

The remaining Radix-owned controls receive the build-time semantic tokens and
are listed above so the boundary stays visible.

Run `pnpm --filter @agent-native/example-chat-mui typecheck` to verify the
adapter against the workspace contract.
