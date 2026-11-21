---
"@agent-native/core": patch
---

Agent calls from the built-in chat, MCP, WebMCP, and A2A now share one `isAgentCaller` check. Read-only actions, write actions, and detail opens keep the user's current view by default across `createNavigateAction()` and the application-state store unless `intent: "open"` (or `allowsAgentNavigation: true` on an explicit UI-opening action) is set, and `navigateAfterWrite` skips post-write navigation for agents without an open intent.
