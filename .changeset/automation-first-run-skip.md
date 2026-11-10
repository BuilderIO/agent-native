---
"@agent-native/core": patch
---

Run a new automation on the scheduler's next tick. When the scheduler last found no automations, it stopped looking for up to five minutes, and creating one on another server instance didn't end that wait.
