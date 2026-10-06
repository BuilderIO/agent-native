---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Status checks that get refreshed mid-request now return the fresh answer instead of reporting the server as unreachable, so chat no longer gets stuck on "Couldn't confirm AI is ready" with prompts waiting to send. Retry on that message now clears the stuck state.
