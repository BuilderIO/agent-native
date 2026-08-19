---
"@agent-native/core": patch
---

Warn on the Agent Automations page when schedule-triggered automations can never fire — recurring jobs disabled at build time, no durable scheduler on the hosting target, or local development — via a new `get-scheduled-trigger-status` action.
