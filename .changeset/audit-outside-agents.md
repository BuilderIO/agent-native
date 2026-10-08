---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Record actions called by outside agents over MCP, WebMCP, or A2A as the agent acting for the user, not as the user. Rows recorded before this change read the same way, and the Settings audit log names the protocol ("Agent via MCP").
