# Chat with Ant Design

This is a full Chat template app wired to Ant Design 6 through the
`@agent-native/toolkit/design-system` contract. Read
[`app/design-system.tsx`](app/design-system.tsx) for the complete adapter and
the ConfigProvider theme mapping.

All 17 contract components are registered. In the shipped Chat surfaces, 16/17
currently render through the registered Ant Design adapters:

- `ActionButton`/`IconButton`: chat-history rail and shared actions.
- `TextField`/`TextArea`/`Picker`/`Checkbox`/`Switch`/`Tabs`: settings and
  sharing controls.
- `Dialog`/`Avatar`/`Status`: the sharing dialog.
- `Tooltip`/`Popover`/`Spinner`/`Skeleton`: agent-panel and sidebar chrome.
- `Surface`: the Builder connection card.

`Menu` is the one explicit gap. The agent-panel header menu still owns a live
`RunsTrayMenuItem` compound submenu whose arbitrary run rows cannot be expressed
by the v1 data-only `Menu` contract, so it remains Radix-owned. This is a known
gap, not a claim that every visible control is Ant Design-backed. The
assistant-ui composer/message renderer, cmdk command-menu internals, and Tiptap
editor are also v1 non-goals; their surrounding chrome is bridged or tokenized.

Light and dark ConfigProvider themes use the same exported `theme` passed to
the Core Vite plugin. Tokens are generated once at build time, never per
request.

The remaining Radix-owned controls receive the build-time semantic tokens and
are listed above so the boundary stays visible. Verify with:

```sh
pnpm --filter @agent-native/example-chat-antd typecheck
```
