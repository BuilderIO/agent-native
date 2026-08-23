---
"@agent-native/core": patch
---

Add `mcpTool` and `important` to `defineAction`, so an action declares its external-agent exposure and its first-request tool slot beside itself instead of in a plugin-level name list. `mcpTool: false` hides an action from every MCP tier and the direct A2A surface (including the `--full-catalog` opt-in) while the in-app agent keeps calling it; `mcpTool: true` is the action-owned form of `mcp.connectorCatalog` membership. `important: true` puts an action in the agent's first tool list and narrows the derived default to the marked actions, the action-owned form of `initialToolNames`. Both name lists keep working, so an app can migrate one action at a time.
