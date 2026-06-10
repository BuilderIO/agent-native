---
"@agent-native/core": patch
---

Wrap Drizzle's Neon pool with the same withDbTimeout + retryOnConnectionError resilience as the raw DbExec path, preventing frozen-WebSocket 500s on template actions.
