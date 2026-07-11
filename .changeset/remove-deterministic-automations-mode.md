---
"@agent-native/core": patch
---

Removed the never-implemented deterministic automations mode — the manage-automations schema now offers agentic only, and legacy deterministic values are rejected at define time instead of silently never firing.
