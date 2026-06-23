---
"@agent-native/core": patch
---

Add observability and a safety valve for inline MCP App embeds, on top of the
Codex/Cursor transplant fix already shipped in 0.70.0.

When an inline embed cannot load in a host, the shell now reports a bounded,
structured diagnostic (stage, message, HTTP status, host, render mode, bridge
type) to a new CORS-open `POST /_agent-native/mcp/embed-error` route, which
forwards it to Sentry via `captureError` — so embed failures across Codex,
Cursor, ChatGPT, and Claude are inspectable instead of an opaque spinner. The
failure card also surfaces the specific cause (e.g. "Embedded app returned HTTP
500" / session-expired) and promotes "Open in new tab" to the primary action.

Adds a deploy-toggleable kill switch for inline MCP App embeds, **off by
default**. Set `AGENT_NATIVE_MCP_APPS_INLINE=1` to enable inline embeds for an
environment; while it is off, accounts listed in
`AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS` (comma/space separated) still get
them, so a fix can be verified in production before it reaches normal users.
When disabled, no `ui://` resource is advertised or referenced and tool results
fall back to their deep-link text — no skills/instructions change required.
