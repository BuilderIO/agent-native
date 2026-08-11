---
"@agent-native/core": patch
---

Move legacy auth sessions and OAuth token storage into release-time migrations so production request handlers do not attempt schema changes.
