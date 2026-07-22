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
- `Dialog`/`Avatar`/`Status`: the real Core sharing dialog on the shipped
  `/design-system-proof` route.
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

To exercise dark mode, open the command menu with `Cmd/Ctrl+K` and choose the
Appearance action. The main Chat canvas is intentionally tokens-only because
the assistant-ui renderer is a v1 non-goal; use settings, sharing, the history
rail, and agent-panel chrome to compare Ant Design rendering.

The example maps Ant Design's generated palette and system typography into the
build-time theme, so app chrome and semantic adapters share the same token
source.

The framework-owned sign-in page is outside the design-system bridge. Use the
authenticated settings, sharing, chat-history, and agent-panel surfaces when
comparing the Ant Design adapter with another adapter.

The app's everyday chat sharing control remains the legacy popover. The
`/design-system-proof` route exists so the complete Core `ShareDialog` contract
is reachable and visually testable without claiming that popover is already an
Ant Design dialog.

The remaining Radix-owned controls receive the build-time semantic tokens and
are listed above so the boundary stays visible. Verify with:

```sh
pnpm --filter @agent-native/example-chat-antd typecheck
```
