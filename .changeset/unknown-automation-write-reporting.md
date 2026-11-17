---
"@agent-native/core": patch
---

Pause automations after uncertain writes, including manual runs and terminal failures or recovery, and keep the safety pause until the owner explicitly resumes them. Preserve the paused status and report the latest failure when a manually triggered run finishes during the pause.
