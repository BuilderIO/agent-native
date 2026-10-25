---
"@agent-native/core": patch
---

MCP results now show a value that mentions the embed start route as `"[hidden embed URL]"` under its key, instead of dropping the key, so a reader can tell a hidden value from a missing one. Keys that themselves mention the route, ticket fields and echoed credentials are still removed, and an open link whose URL is hidden is still left out whole.
