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
