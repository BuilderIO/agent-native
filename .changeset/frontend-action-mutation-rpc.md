---
"@agent-native/core": patch
---

Prevent frontend action calls from failing with 405 errors when a mutating action declares PUT or DELETE and the caller uses the default mutation transport.
