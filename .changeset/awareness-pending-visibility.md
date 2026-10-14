---
"@agent-native/core": patch
---

Awareness events on the SSE stream now wait for a pending access check instead of being dropped, matching how change events are delivered.
