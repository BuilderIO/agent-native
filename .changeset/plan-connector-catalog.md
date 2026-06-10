---
"@agent-native/core": patch
---

Allow `mcpApp: { compactCatalog: true }` without a `resource` so non-UI actions (read, update, list, share) can be flagged into the compact MCP Apps catalog independently of an iframe embed. Makes `resource` optional on `ActionMcpAppConfig` and updates `defineAction` to preserve the flag when no resource is provided.
