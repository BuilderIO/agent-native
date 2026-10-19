---
"@agent-native/core": patch
---

The agent and MCP clients can no longer create organization service tokens or change a service principal's policy or lifecycle. These stay available to owners and admins through `connect --service-token`, the HTTP action routes, and settings.
