---
"@agent-native/core": patch
---

Fix `findMcpIntegrationForText` suggesting the Box MCP integration on unrelated
prose (e.g. "text box", "bounding box"). Added an optional `promptAliases`
field on `DefaultMcpIntegration` so ambiguous display names can require a
qualified phrase before matching; the Box integration now only matches
"Box.com", "Box files", "Box folder", or "Box drive".
