---
"@agent-native/core": patch
---

Accepting a suggestion that can no longer be placed now fails with a 409 `suggestion_stale` error and leaves the suggestion pending, instead of returning success while marking it stale. A decision sent with an outdated `observedBase` now fails with `suggestion_conflict` without changing the suggestion, and a stale proposal member reports `suggestion_stale` too.
