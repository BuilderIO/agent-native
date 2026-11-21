---
"@agent-native/core": minor
---

Offer the MCP script catalog only to organizations listed in `mcp.scriptOrgs` (`AGENT_NATIVE_MCP_SCRIPT_ORGS`), checked against each request's own organization when tools are listed and when they are called. Turning on `mcp.scriptTools` alone now offers it to no one. Connections from a listed organization are told, in the server's instructions, that bulk work can run as a script on that catalog.

Keep an action's `mcpScript: "write"` and its `mcpScriptWrite` contract when the action is loaded from an app's registry or the dev scan. Until now only reads survived loading, so scripts could not call any app's writes.
