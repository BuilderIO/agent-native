---
"@agent-native/core": patch
---

A2A `tasks/cancel` now returns error -32002 (TaskNotCancelableError) for a task that is already completed, failed, or canceled. Before, it overwrote that final state with `canceled`.
