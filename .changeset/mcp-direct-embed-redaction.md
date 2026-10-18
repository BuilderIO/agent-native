---
"@agent-native/core": patch
---

Hide embed start URLs and their tickets from direct MCP tool results when they are nested in another URL, used as an object key, or sit beside a `ticket` field, including a ticket beside `_agentImages`, and in error messages, action links and image notes. Direct results are read as JSON before anything else, so a `toJSON` method or getter cannot add a start URL after the check, and a BigInt in a result is sent as its decimal string instead of failing a call that already ran. When anything a call produced holds a start URL, including a proxied tool's `_meta` or a URL an action's link builds, the call's text and `structuredContent` drop every `ticket` field and hide that ticket wherever it is echoed. Shared MCP action calls hide echoed tickets the same way. App-only tools such as `create_embed_session` now return their start URL in `_meta["agent-native/embedStart"]` instead of `structuredContent`, and the embed widget reads it from there.
