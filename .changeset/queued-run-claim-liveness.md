---
"@agent-native/core": patch
---

Report a queued "Run now" as running while its worker's claim lease is live. The read path measured liveness from the queue insertion time, so a run claimed after waiting past the 15-minute ceiling looked interrupted while it was starting; dispatch-pending rows now measure from `claimed_at`, matching the claim lease the scheduler already uses.
