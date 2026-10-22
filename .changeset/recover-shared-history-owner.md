---
"@agent-native/core": patch
---

Recover a stopped worker's stale automation history under the owner the run was recorded with. Legacy shared automations store their history under the resolved execution identity — the organization for org-bound runs, the creator otherwise — so querying the resource owner left those runs open until the 25-hour reaper.
