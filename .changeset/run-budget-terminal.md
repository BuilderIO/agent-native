---
"@agent-native/core": patch
---

Mark exhausted in-process agent-loop budgets as non-recoverable so the client does not restart the same exhausted run.
