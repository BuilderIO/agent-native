---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Consolidate every MCP setting on `createAgentChatPlugin` under one `mcp: {}` option, and add `mcp.catalog: "app"`.

`mcp` accepts `enabled`, `catalog`, `connectorCatalog`, `externalAgents`, `builtinCrossAppTools`, `title`, `description`, `websiteUrl`, and `icons`. The top-level `disableMcp`, `mcpServerInfo`, `connectorCatalog`, and `externalAgents` stay accepted for one minor and are deprecated; the nested value wins, and setting both forms to disagreeing values throws at plugin init rather than booting an app with an MCP surface nobody chose (same contract as `resolveFrameworkTools`). `disableMcp: true` and `mcp.enabled: false` are normalized as inverses, so a correctly migrated app is not read as a conflict.

Two behavior fixes come with it:

- `builtinCrossAppTools` had no route through the plugin at all — it was reachable only by calling `mountMCP` directly. That is why `frameworkTools: "minimal"` and `workspaceApps: false` could never remove the cross-app builtins (`list_apps`, `open_app`, `ask_app`, `ask_app_status`, `create_embed_session`, `create_workspace_app`, `list_templates`) from an app using the normal plugin entry point: the MCP layer merges them downstream of the `frameworkTools` filter. `mcp.builtinCrossAppTools: false` is now the switch.
- A2A read the connector policy straight off the raw plugin options, so `mcp.connectorCatalog` would have narrowed the MCP surface while A2A kept serving the old one. `filterDirectA2AActions` / `buildAuthenticatedAgentA2ASkills` now take the resolved shape, so the two external surfaces cannot diverge.

`mcp.catalog: "app"` serves external callers exactly the app's own tool registry, flat — the same actions the in-app agent holds, with no cross-app builtins, no `ask-agent`, no `tool-search`, and no compact/connector trimming. `externalAgents.denyActions` and the OAuth scope filter still apply, since both are explicit removals rather than catalog tiering, and the dev-open surface split is unchanged (an unauthenticated loopback probe still gets `actions`, not `productionActions`). Weigh the token cost before setting it: an app registering ~100 actions puts every schema in the caller's context on `tools/list`, which is what the compact default exists to avoid.

Also folds the per-tier `tools/call` gate into one rule — the advertised set is the callable surface on every tier except the explicit `--full-catalog` opt-in — so adding a tier can no longer default to "everything callable" by omission.

`tool-search` is fixed on both ends over MCP. It is dropped entirely from every flat catalog (`mcp.catalog: "app"` and the `--full-catalog` opt-in), where every tool is already listed beside it and it could only describe its own neighbours. On the trimmed catalogs, where it does earn its place, it is now scoped to the advertised set: previously it closed over the app's whole registry while `tools/call` accepted only the advertised subset, so it answered with names that came straight back as "Unknown tool". `attachToolSearch`, `searchToolRegistry`, `createToolSearchEntry`, `TOOL_SEARCH_ACTION_NAME`, `resolveFrameworkTools`, `filterFrameworkToolGroups`, and `frameworkGroupEnabled` are now exported from `@agent-native/core/server`, so a standalone `mountMCP` plugin can compose the same surface the agent-chat plugin does instead of hand-rolling a copy that drifts.
