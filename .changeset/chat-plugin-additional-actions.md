---
"@agent-native/core": patch
---

Add a `resolveAdditionalActions` option to `createAgentChatPlugin` so apps can add request-scoped actions for the signed-in caller on interactive chat, A2A, and MCP `ask_app` requests. Entries never replace a registered template, framework, or MCP action.
