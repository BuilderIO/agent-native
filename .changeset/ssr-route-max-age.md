---
"@agent-native/core": patch
---

An SSR route can shorten its own shared-cache window with the `SSR_MAX_AGE_HEADER` response header. The handler removes the header and only ever lowers the deployment policy; `0` stores nothing.
