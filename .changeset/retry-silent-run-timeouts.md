---
"@agent-native/core": patch
---

Stop the agent chat from giving up on the first soft-timeout when a turn hasn't produced visible output yet. A complex first turn can spend the whole ~40s soft-timeout window "thinking" before any text or tool call, which previously surfaced "The agent stopped before finishing" with zero retries. Silent run timeouts now retry through a larger empty-continuation budget (1 → 3) so transient slow starts recover, while the cap still terminates a genuinely stuck turn with a clear message instead of looping forever.
