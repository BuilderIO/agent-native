---
"@agent-native/core": patch
---

Add an optional `exhaustedDraftPrefix` to `AgentLoopFinalResponseGuardResult`. When the final-response guard's retries are exhausted, an app that sets this field keeps the model's non-empty draft and prepends the prefix instead of replacing it with `fallbackMessage`; an empty draft still falls back to `fallbackMessage`. Apps that don't set the field keep the existing replace behavior.
