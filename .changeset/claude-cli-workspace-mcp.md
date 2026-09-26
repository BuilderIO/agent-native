---
"@agent-native/core": patch
---

Give local Claude Code runs the same workspace app MCP servers that Codex runs already receive, through a private `--mcp-config` file that is removed after the run. Both paths now reject MCP server IDs that normalize to the same key (for example `sales.prod` and `sales/prod`) instead of silently dropping one of them.
