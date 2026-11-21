---
"@agent-native/core": patch
---

Fix resource-specific action query invalidation for sync events and local mutations, so matching queries refresh without invalidating unrelated resources.
