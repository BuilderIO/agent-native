---
"@agent-native/core": patch
---

`/runs/active` now reports `retryable` for an errored run, so a client can skip its automatic retry when the provider rejected the request and resending would fail the same way. The chat client, the server's continuation checks, and error formatting now share one check for a rejected request.
