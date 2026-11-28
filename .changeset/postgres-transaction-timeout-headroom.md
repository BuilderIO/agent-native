---
"@agent-native/core": patch
---

Account for setup round-trip time when tightening transaction statement timeouts, reserving at least 50ms or 125% of the first setup round trip for the second. Predicted caps can be lower than before, so queries may be canceled sooner; the timeout and its headroom are best-effort because network transit time is unknown.
