---
"@agent-native/core": patch
---

Stop one sync event for another app's resource type from making every poll fail with a 409 and re-reading data in a loop.
