---
"@agent-native/core": patch
---

Fix MCP App embed rendering in ChatGPT/Codex hosts:

- Stop the `openai:set_globals` storm that left embeds stuck blanking by
  guarding the bridge sync on a signature that ignores host `maxHeight`, and
  by not re-blanking once the app frame has launched.
- Size embeds to their content: the embedded app reports its real
  `scrollHeight` via `agentNative.contentHeight` and the shell sizes the iframe
  to that (plus chrome) instead of the host max, so plans no longer render far
  too tall or too short.
- Suppress empty embeds: when a tool whose descriptor declares an embed widget
  produces no embeddable content, the result is marked `isError` so the host
  shows the text result without an empty widget box. This also keeps read-only
  and comment-mutation tools from rendering an embed for results that produce
  no plan surface.
- Bump the embed shell resource version so hosts refetch the updated shell.
