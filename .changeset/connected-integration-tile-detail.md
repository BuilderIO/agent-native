---
"@agent-native/toolkit": patch
---

Every connected integration tile opens a detail page

A connected remote MCP server's tile was an inert element whose only control was a "…"
menu, so a connected integration (a remote MCP server or a custom one added by URL) could
not be opened, inspected or reconnected — while a catalog tile always could. Connected
tiles are now links to the same settings detail page, and the page resolves a connected
server that has no catalog entry (a custom integration) by the slug the tile links to,
showing status, scope, tools, the error reason, Reconnect and Remove. The id convention
lives in one module so the tile and the page cannot drift apart.
