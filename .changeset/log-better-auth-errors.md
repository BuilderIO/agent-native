---
"@agent-native/core": patch
---

Log the real Better Auth error code/message and report it to Sentry before
sanitizing the direct Better Auth handler's error responses, so a
misconfiguration like `INVALID_ORIGIN` is visible in logs/Sentry instead of
only showing the generic public error message.
