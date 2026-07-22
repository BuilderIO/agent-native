# Chat with Material UI

This is a real Chat template app wired to Material UI 9 through the
`@agent-native/toolkit/design-system` contract. The complete adapter is in
[`app/design-system.tsx`](app/design-system.tsx); it is intentionally the
smallest useful reference for a CSS-in-JS design system with its own
ThemeProvider and overlay stack.

## What is bridged

All 17 contract components are registered: actions, fields, status/surface,
avatar, tooltip/menu/popover/dialog/picker, checkbox/switch, and tabs. The chat
history rail uses the Material UI ActionButton adapter. Toolkit/Core surfaces
that still use Radix or assistant-ui internals retain their own implementation;
they receive the build-time semantic tokens but are documented as tokens-only
until a matching slot exists.

Material UI's light and dark themes are selected from `next-themes`, while the
same `theme` export is passed to the Core Vite plugin for build-time CSS tokens.
No runtime or request-specific theme CSS is generated.

## Known gaps

The assistant-ui composer/message renderer, cmdk command-menu internals, and
Tiptap editor are v1 non-goals. Their surrounding chrome is bridged or
tokenized, and this README makes the boundary explicit rather than pretending
that those third-party surfaces render Material UI controls.

Run `pnpm --filter @agent-native/example-chat-mui typecheck` to verify the
adapter against the workspace contract.
