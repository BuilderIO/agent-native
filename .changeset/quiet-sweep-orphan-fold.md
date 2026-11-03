---
"@agent-native/core": patch
---

Stop retrying a stopped run's thread projection forever when its prompt never reached the thread. The stuck run made every background sweep return 500.
