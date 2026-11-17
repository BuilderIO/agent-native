---
"@agent-native/core": patch
---

The scaffolded actions skill now tells agents that an action its app's agent can call needs an MCP decision: `mcpTool: true` serves it to outside agents, and `mcpTool: false` keeps it in the app, with a comment saying why.
