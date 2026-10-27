---
"@agent-native/core": patch
---

A2A `message/send` and `message/stream` no longer overwrite a task that `tasks/cancel` already canceled. If the handler finishes after the cancel, the response is the canceled task.
