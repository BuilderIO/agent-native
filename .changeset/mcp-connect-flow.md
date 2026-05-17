---
"@agent-native/core": minor
---

Frictionless connect for external agents. New `agent-native connect <url>`
(and `connect --all`) drives an OAuth-style device-code flow: a logged-in
browser session mints a per-user, scoped, **revocable** MCP token (an
`A2A_SECRET`-signed JWT with a `jti`) and the CLI writes the HTTP MCP server
entry for every detected client (Claude Code desktop/CLI, Codex, Cowork) — no
shared secret copying, no local server. Adds the framework-served
`/_agent-native/mcp/connect` page + token mint / device-code / list / revoke
endpoints (mounted by the core routes plugin, gated by `disableMcpConnect`),
two additive framework tables (`mcp_connect_tokens`, `mcp_device_codes`), a
`jti` revoke check in the MCP `verifyAuth`, and an optional `extraClaims` on
`signA2AToken`. Connecting to hosted apps is now the primary documented path;
local-dev `mcp install` / stdio remains as the advanced path.
