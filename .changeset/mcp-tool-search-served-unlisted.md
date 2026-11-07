---
"@agent-native/core": patch
---

Add `mcpTool: "search"`, a third MCP decision for an action: outside agents can use it, but it stays out of their tool list on the default catalogs, so a long catalog stays short. `tool-search` finds it and marks it `callWith: "call-tool"`, and a new `call-tool` tool (listed only when an app has such actions) runs it with the same deny list, grants, scopes and approvals as a direct call. Clients that can call tools by name may call it directly. Full catalogs list it as usual, and when writes go through `ask_app` only its reads are served.
