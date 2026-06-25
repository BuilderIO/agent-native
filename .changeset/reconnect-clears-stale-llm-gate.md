---
"@agent-native/core": patch
---

Re-check current LLM connection status before a stale missing-credentials event can keep chat locked after reconnecting Builder, and prevent page chat surfaces from rendering sidebar settings in the main content area.
