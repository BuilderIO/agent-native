---
"@agent-native/core": patch
---

A Builder.io upload that gets a 401 when the token can't be refreshed is now reported as rejected credentials, so Clips asks the user to reconnect storage instead of showing a retryable "refresh and try again" error.
