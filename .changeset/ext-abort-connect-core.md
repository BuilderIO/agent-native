---
"@agent-native/core": patch
---

`McpClientManager` accepts an `AbortSignal` option that abandons in-flight server connects and closes their transports when it aborts.
