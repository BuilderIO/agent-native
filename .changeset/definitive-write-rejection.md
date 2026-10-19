---
"@agent-native/core": patch
---

Treat a write action's definitive 4xx / `fail()` rejection as a completed error, not `outcomeUnknown`, so the model can retry the same tool instead of dead-ending the turn.
