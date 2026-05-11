---
"@agent-native/core": patch
---

Add rich Sentry tags (model, gatewayOrigin, gatewayRequestId) for no-detail Builder gateway errors and fix the user-facing copy to stop promising auto-recovery and model switching, which don't actually help for this error code.
