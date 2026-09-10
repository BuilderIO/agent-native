---
"@agent-native/core": patch
---

Clear stale Builder connect states when a callback attempt fails, so restarting the connection recovers instead of staying ambiguous forever.
