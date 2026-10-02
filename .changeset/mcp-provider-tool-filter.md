---
"@agent-native/core": patch
---

Let apps limit `listVisibleMcpTools` and `callMcpTool` to servers whose URL belongs to a named provider, so a server that reuses another provider's tool names cannot receive its calls.
