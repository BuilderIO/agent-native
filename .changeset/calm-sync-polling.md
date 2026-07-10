---
"@agent-native/core": patch
---

Reduce idle hosted request volume by relaxing database sync polling between agent runs, waking event-driven application-state readers only when their values change, and avoiding duplicate action-query invalidation waves.
