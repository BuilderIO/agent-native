---
"@agent-native/core": patch
---

Fix MCP app embeds rendering only a flashing/permanent loading state in Codex
and Cursor. These standards-track hosts render the `ui://` resource in a strict
opaque-origin sandbox (`sandbox="allow-scripts"`) and talk to it over the
postMessage `ui/*` bridge. The shell's handshake was already correct, but for
these hosts it fell through to self-navigating the sandboxed iframe to the real
app origin, which tears down the host bridge and loses the opaque-origin auth
context. Any host connected through the native MCP Apps bridge (Codex, Cursor,
the SDK App fallback, our own renderer) now transplants the app document into
the shell — the same robust path Claude already uses — keeping the bridge alive
and loading via embed-token auth. Also handle the spec `host-context-changed`
notification and bump the cached resource shell version so hosts refetch.

When an inline embed still cannot load in a host, the shell now reports a
bounded, structured diagnostic (stage, message, HTTP status, host, render mode,
bridge type) to a new CORS-open `POST /_agent-native/mcp/embed-error` route,
which forwards it to Sentry via `captureError` — so embed failures across Codex,
Cursor, ChatGPT, and Claude are finally inspectable instead of an opaque
spinner. The failure card also surfaces the specific cause (e.g. "Embedded app
returned HTTP 500" / session-expired) and promotes "Open in new tab" to the
primary action.

Adds a deploy-toggleable kill switch for inline MCP App embeds, **off by
default**. Set `AGENT_NATIVE_MCP_APPS_INLINE=1` to enable inline embeds for an
environment; while it is off, accounts listed in
`AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS` (comma/space separated) still get
them, so a fix can be verified in production before it reaches normal users.
When disabled, no `ui://` resource is advertised or referenced and tool results
fall back to their deep-link text — no skills/instructions change required.
