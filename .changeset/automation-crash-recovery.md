---
"@agent-native/core": patch
---

Recover interrupted scheduled automations from their worker heartbeat on scheduler ticks, resume unfinished steps in the same durable turn, and preserve journal-confirmed side effects in failure messages.
