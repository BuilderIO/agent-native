---
"@agent-native/core": patch
---

Persist a run's terminal reason atomically with its terminal status so a successor lease cannot leave the completed run without a reason.
