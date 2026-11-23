---
"@agent-native/core": patch
---

Propagate feature flag database connection failures instead of retrying every flag separately, and fail closed when a flag refresh fails despite cached values.
