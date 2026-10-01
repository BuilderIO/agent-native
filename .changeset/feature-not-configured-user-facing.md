---
"@agent-native/core": patch
---

Actions that throw `FeatureNotConfiguredError` now return its message with a 400 status and `errorCode: "feature_not_configured"` instead of a generic "Internal server error".
