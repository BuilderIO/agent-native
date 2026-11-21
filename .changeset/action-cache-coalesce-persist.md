---
"@agent-native/core": patch
---

The persisted action query cache no longer scans every localStorage key for each query cache notification while a write is already queued. Epoch and clear-intent checks still run before each storage write and each new queue.
