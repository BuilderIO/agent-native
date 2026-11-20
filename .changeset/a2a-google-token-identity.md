---
"@agent-native/core": patch
---

A2A calls no longer carry the caller's Google access token, and the receiving agent takes the run's user only from a verified A2A token, never from a Google token in message metadata.
