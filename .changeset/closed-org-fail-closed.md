---
"@agent-native/core": patch
---

`ORG_CREATION=closed` no longer falls back to letting the first authenticated user create the canonical organization when `AUTH_BOOTSTRAP_ADMINS` is unset or empty. Organization creation is now refused with a 403 until at least one verified bootstrap admin is configured and signs in.
