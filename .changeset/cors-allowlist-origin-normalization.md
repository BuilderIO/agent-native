---
"@agent-native/core": patch
---

Fix `CORS_ALLOWED_ORIGINS` exact-match comparison to tolerate operator formatting differences (scheme/host casing, a trailing slash, or a bare domain with no scheme) instead of silently rejecting an otherwise-legitimate configured origin.
