---
"@agent-native/core": patch
---

A tool call now times out even while its app authorization lookup is still pending, so a stalled lookup no longer leaves the run waiting on a tool with no result.
