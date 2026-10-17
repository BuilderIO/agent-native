---
"@agent-native/core": patch
---

Stop a lone collab editor from polling every 2.5 s on serverless when its app posts updates under its own tab id instead of `getBrowserTabId()`.
