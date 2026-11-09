---
"@agent-native/core": patch
---

Record a Builder gateway "internal error, ERROR ID" stop as a gateway internal error instead of `invalid_request`, without resending the same request, and log the request size on it.
