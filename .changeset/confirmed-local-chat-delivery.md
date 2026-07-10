---
"@agent-native/core": patch
---

Add cancellation-safe `sendToAgentChatAndConfirm` delivery confirmation and its submit-result event contract so callers can preserve user work when a local chat message is rejected or times out, without allowing that timed-out message to arrive later.
