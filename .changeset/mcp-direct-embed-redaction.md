---
"@agent-native/core": patch
---

Hide embed start URLs and their tickets from direct MCP tool results when they are nested in another URL, used as an object key, or sit beside a `ticket` field, including a ticket beside `_agentImages`, and in error messages, action links and image notes. Direct results now use the same redaction as shared MCP action calls. App-only tools such as `create_embed_session` now return their start URL in `_meta["agent-native/embedStart"]` instead of `structuredContent`, and the embed widget reads it from there.
