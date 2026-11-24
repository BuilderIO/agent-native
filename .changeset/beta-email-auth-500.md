---
"@agent-native/core": patch
---

Email and password sign-in and sign-up now answer a typed `AUTH_SCHEMA_NOT_MIGRATED` 503, and report it, instead of a generic server error when the auth tables were never migrated.
