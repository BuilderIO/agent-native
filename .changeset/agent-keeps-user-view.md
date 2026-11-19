---
"@agent-native/core": patch
---

Agent calls from the built-in chat, MCP, WebMCP, and A2A now share one `isAgentCaller` check. Read-only actions no longer move the user's view during an agent call, `createNavigateAction({ isDetailView })` asks agents for `intent: "open"` before opening one item, and `navigateAfterWrite` lets a write follow its result only for people or an explicit open intent.
