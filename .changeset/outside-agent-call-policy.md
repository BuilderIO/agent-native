---
"@agent-native/core": patch
---

Export `isOutsideAgentCall` from the browser entry of `@agent-native/core` too, so browser builds resolve the same outside-agent check as the server entry.
