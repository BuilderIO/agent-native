---
"@agent-native/core": patch
---

Let a continuation resume a turn after a completed private action (for example, saving a draft) instead of failing with "Private content omitted". A resumed turn refuses to run an already-completed private write again, and private-safe errors keep their code and fixed message.
