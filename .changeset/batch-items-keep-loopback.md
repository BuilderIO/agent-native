---
"@agent-native/core": patch
---

Batched action reads now authenticate like their own GET in the desktop app's local development sign-in, instead of returning 401 per item and clearing the persisted query cache.
