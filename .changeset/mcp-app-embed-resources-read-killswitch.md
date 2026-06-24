---
"@agent-native/core": patch
---

Fix inline MCP App embeds being hard-killed on `resources/read`. The inline-embed kill switch was enforced inside the shared `resolveMcpAppResource` resolver, which also backs `resources/read` — so when a host read a `ui://` URI it already held (e.g. a cached descriptor) while embeds were disabled, it got a hard `-32603` instead of the shell. The switch is now enforced only at the advertisement/render sites (`tools/list` descriptor meta, `tools/call` result meta, `resources/list`), so disabled embeds are never advertised while `resources/read` still degrades gracefully to the served shell.
