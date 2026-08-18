---
"@agent-native/core": patch
---

Sanitize every tool schema at the engine boundary, not just `defineAction` ones.
Hand-written tools (extensions, MCP, context tools) and third-party MCP server
schemas bypassed the sanitizer entirely, so `extension-data-set` shipped a `data`
property with no `type` and OpenAI 400'd the whole request — every tool in the
payload, not just that one.
