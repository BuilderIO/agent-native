---
"@agent-native/core": patch
---

Suppress Node 22 web stream close races from Vite dev socket error handling so `agent-native dev` does not crash during startup.
