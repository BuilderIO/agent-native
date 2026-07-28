---
"@agent-native/core": patch
---

Reduce agent-chat startup request fan-out by sharing concurrent status, session, model-discovery, and thread-list reads.
