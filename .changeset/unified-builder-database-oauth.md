---
"@agent-native/core": patch
---

Let authenticated Builder consumers share one request-authorization resolver, including the org-scoped, read-only Publish MCP grant used by Content database sources, while preserving legacy key fallback.
