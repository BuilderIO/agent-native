---
"@agent-native/core": patch
---

Advertise each action's declared `mcpAnnotations` on every MCP catalog, not just the directory profile, so a Trash move or overwrite no longer reaches hosts as `destructiveHint: false`. Actions can also declare an optional `idempotentHint`.
