---
"@agent-native/core": patch
---

Hide embed start URLs and their tickets from direct MCP tool results when they are nested in another URL, used as an object key, or sit beside a `ticket` field, and in error messages, action links and image notes. Direct results now use the same redaction as shared MCP action calls.
