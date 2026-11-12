---
"@agent-native/core": patch
---

Record content-free request sizes and stream milestones for each main-loop model attempt in local traces, including failed attempts and retry waits. Keep unreported usage and absent first-event timestamps distinguishable from measured zero values.
