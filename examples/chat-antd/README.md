# Chat with Ant Design

This is a full Chat template app wired to Ant Design 6 through the
`@agent-native/toolkit/design-system` contract. Read
[`app/design-system.tsx`](app/design-system.tsx) for the complete adapter and
the ConfigProvider theme mapping.

All 17 contract components are registered, including Ant Design's native
dropdown, popover, modal, select, form, and tabs implementations. The chat
history rail and toolkit button surfaces therefore use Ant Design controls;
Core/assistant-ui internals that are v1 non-goals remain visible as
tokens-only/Radix-owned surfaces and are not mislabeled as bridged.

Light and dark ConfigProvider themes use the same exported `theme` passed to
the Core Vite plugin. Tokens are generated once at build time, never per
request.

Known gaps are the assistant-ui composer/message internals, cmdk command-menu
internals, and Tiptap editor. Their surrounding chrome remains covered by the
bridge where a slot exists. Verify with:

```sh
pnpm --filter @agent-native/example-chat-antd typecheck
```
