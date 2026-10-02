---
"@agent-native/core": patch
---

An app action that shares a name with a code-execution tool, such as `list-data-programs`, now keeps that name. Previously the framework's version replaced it on every agent and MCP surface, which dropped the app's `mcpTool` exposure.
