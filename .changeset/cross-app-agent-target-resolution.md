---
"@agent-native/core": patch
---

Fix cross-app delegation reporting an unresolvable target as remote downtime.
`findAgent` matched a handle exactly, so `agent="plans"` missed the `plan` app
even though the Plan app labels itself "Plans" in its own sidebar, nav state,
and skills — twelve of thirteen first-party apps had the same latent miss in one
grammatical number or the other. `findAgent` now also resolves the singular or
plural variant, and refuses to guess when two agents differ only by a trailing
"s". When a target still cannot be resolved, `call-agent` now throws a typed
`agent_not_found` failure, logs it, and emits `$a2a_invocation` telemetry
instead of returning an `Error: ...` string that the agent loop scored as a
successful tool call and the model retold as "The Plans app is temporarily
unavailable."
