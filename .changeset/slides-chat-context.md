---
"@agent-native/core": patch
---

Keep concurrent chat submissions on one durable thread head and retry transient thread saves so newer user turns remain visible and ordered.
