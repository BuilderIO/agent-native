---
"@agent-native/core": patch
---

Make collaborative text and JSON seeding conditional on the state row still being absent, so a concurrent first writer is preserved.
