---
"@agent-native/core": patch
---

Keep suggestion validation and feature flag reads on the active database transaction to avoid stalled local suggestion creation.
