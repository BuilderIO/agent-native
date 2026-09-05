---
"@agent-native/core": patch
---

MCP/WebMCP instructions now advertise the app's key tools from
`initialToolNames` (override with `mcp.keyToolNames`) and name `view-screen`
literally. MCP tool results keep the deep link and surface
`nextRequiredAction` as "Next: …".
