---
"@agent-native/core": minor
---

Collapse the core-routes `mcpConnect*` options into one `mcp` object, and fix the MCP server name on multi-label hosts.

`createCoreRoutesPlugin({ mcp: { connect, serverName } })` replaces the four flat keys `disableMcpConnect`, `mcpConnectServerName`, `mcpConnectAppId`, and `mcpConnectAppName` — the same shape `AgentChatMcpOptions` already uses for the protocol mount. All four stay accepted for one minor; setting both forms to disagreeing values throws at plugin init rather than booting with a connect surface nobody chose.

The two identity keys are deprecated outright rather than carried over: `app.id` and `app.name` are declared config fields, so a per-surface option for them is a third spelling of one thing. Unset, they now resolve from config — the same value the runtime config report already read.

An explicit `serverName` is returned verbatim, prefix and all — it pins an id clients already hold in their config, which is why Plan publishes the bare `plan` rather than the derived `agent-native-plan`.

Fixes the server name on hosts with more than one leading label. `serverName` fell back to the first hostname label, and every beta deployment is `beta.<app>.agent-native.com`, so all of them advertised themselves as `agent-native-beta`. Clients key their MCP config by that name, so connecting a second beta app replaced the first. Identity now resolves from `app.id` / `app.template` / `app.slug` before the hostname, which covers every first-party template with no configuration.
