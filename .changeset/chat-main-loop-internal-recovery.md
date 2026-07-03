---
"@agent-native/core": patch
---

Keep hosted chat runs inside the active worker when a progress-aware action-preparation checkpoint asks to continue, instead of depending on the browser to start the recovery turn.
