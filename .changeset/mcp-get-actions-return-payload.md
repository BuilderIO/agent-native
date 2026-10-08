---
"@agent-native/core": patch
---

Fix MCP tool results for GET actions that declare `readOnly: false`: the ChatGPT directory profile no longer collapses a read like Slides `get-deck` into "<title> is ready.", so the model receives the slides, not just the deck title.
