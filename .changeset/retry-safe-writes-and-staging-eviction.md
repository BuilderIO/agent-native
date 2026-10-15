---
"@agent-native/core": patch
---

Stop ending agent runs on `write_tool_outcome_unknown` after an action's own deterministic rejection: actions can declare `retrySafe`, an app's `{ ...entry, run }` wrapper keeps the action's execution boundary, and GET/HEAD provider requests are retry-safe. Staged datasets now evict the oldest scratch data instead of failing every `stageAs` once an app reaches its shared cap, deletes serialize with that eviction, and `stageAs` ids are derived from a hash of the app, owner, and name so owners whose emails sanitize alike no longer collide; `query-staged-dataset` reports a dataset evicted or replaced mid-read instead of an empty result. Rate-limited continuation dispatch retries with jittered backoff and `Retry-After`, a sibling-model fallback gets one attempt, and a valid `automation-no-op` is no longer vetoed by an earlier rejected one. Chat completions to GPT reasoning models send `max_completion_tokens`.
