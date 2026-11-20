---
"@agent-native/core": patch
---

Let a continuation resume a turn after a completed private action (for example, saving a draft) instead of failing with "Private content omitted". A resumed private turn does not re-run a write that already completed in it, and private-safe errors keep their code and fixed message.
