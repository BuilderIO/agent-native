---
"@agent-native/core": patch
---

Recover interrupted scheduled automations from their worker heartbeat on scheduler ticks, resume unfinished steps in the same durable turn, and preserve journal-confirmed side effects in failure messages.

Bind recovery to an app-scoped firing history, stop dispatch after scheduler lease loss, retain recovery until history writes are durable, and fail closed on corrupt run journals.

Preserve interrupted firings during temporary identity lookup failures, settle permanent identity rejection with confirmed delivery evidence, and retain manual-run scheduling and pause policy during recovery.
