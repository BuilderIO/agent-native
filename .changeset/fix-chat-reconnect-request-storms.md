---
"@agent-native/core": patch
---

Abort superseded chat reconnect readers and back off failed reattach attempts so repeated stale runs do not create client request storms.
