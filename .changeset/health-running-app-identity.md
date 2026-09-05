---
"@agent-native/core": patch
---

`/_agent-native/health` reports `database.runningApp` and only claims
`identityMismatch` when the runtime can derive its own app identity; a hosted
bundle that resolves no slug/id reports the gap instead of blocking every
production cutover. The deploy smoke check warns on identity mismatch for this
rollout rather than failing.
