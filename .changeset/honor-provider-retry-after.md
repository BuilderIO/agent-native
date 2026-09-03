---
"@agent-native/core": patch
---

The LLM-completion retry loop now honors a provider's `Retry-After` header
(seconds or HTTP-date, capped at 60s) instead of always sleeping a fixed
exponential backoff. `classifyProviderError` parses the header (reusing the
provider-api quota governor's parser via a new shared
`packages/core/src/shared/retry-after.ts` helper) and the engine error/stop
event shape carries the result as `retryAfterMs`. The retry loop's sleep and
its run-budget estimate now use the same number, so a 429 with a longer
provider-requested wait either waits that long or — if it would not fit the
remaining run budget — surfaces the error instead of silently truncating the
wait.
