---
"@agent-native/core": patch
---

Account for setup round-trip time when tightening transaction statement timeouts, with a 25% buffer for variation in the second setup round trip. Predicted caps can be lower than before, so queries may be canceled sooner; the timeout and its headroom are best-effort because network transit time is unknown.
