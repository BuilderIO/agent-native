---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Expire queued chat submissions when their retry window closes, so Slides cannot start a delayed retry after making it available again.
