---
"@agent-native/core": patch
---

Pause automations after uncertain writes, including manual runs and terminal failures or recovery, and block manual and queued runs while preserving the warning until the owner explicitly resumes them. Blocked queued runs are recorded as skipped in run history.
