---
"@agent-native/core": patch
---

Resume page-load chat reconnect from the last seen run event seq instead of replaying the full SSE history, preventing duplicated assistant turns after refresh.
