---
"@agent-native/core": patch
---

Show object arguments in words on the MCP approval review and in-client approval prompt. A guest given as `{ email, displayName }` reads as `Dana <dana@example.com>`, with any other detail after it (`(Optional: Yes)`), and any other object reads as its labeled values instead of raw JSON. The review's Details section still shows the stored call exactly.
