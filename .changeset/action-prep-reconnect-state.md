---
"@agent-native/core": patch
---

Carry action-preparation stall detection across reconnect reads for the same run so zero-byte tool input retries cannot keep background chats alive indefinitely.
