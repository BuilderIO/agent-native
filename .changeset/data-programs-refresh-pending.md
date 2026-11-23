---
"@agent-native/core": patch
---

A background data program's still-fresh rows now come back marked stale while a newer run of it is queued or running, as after a forced refresh, so a panel can tell new rows are on the way and read again.
