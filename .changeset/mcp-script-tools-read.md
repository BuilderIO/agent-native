---
"@agent-native/core": minor
---

MCP connections can opt into a script catalog that offers only `search-actions` and `run-script`. `run-script` runs model-written JavaScript in a QuickJS sandbox whose only capability is calling the app's read-only actions as `api` functions, so a model can look things up, loop and join results in one tool call. An action becomes callable from scripts by declaring `mcpScript: "read"` in `defineAction`, which throws on an action that can write or asks for approval. Each call goes through the same scope, service-grant and redaction checks as a direct tool call, refused calls are recorded in the audit log, and scripts have limits on time, memory, calls, result size and concurrent runs. The catalog is off unless the app sets `AGENT_NATIVE_MCP_SCRIPT_TOOLS`; a connection opts in with `?catalog=script` or the `x-agent-native-mcp-catalog: script` header.
