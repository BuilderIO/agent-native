---
"@agent-native/agentkit": minor
"@agent-native/core": patch
---

Expose server-confirmed chat persistence, report snapshot save results, and allow canceled persistence requests so the UI can retry failed saves safely. The legacy `persistThreadSnapshot()` method now rejects on transport failure. Callers that previously ignored its promise should handle rejections or use `persistThreadSnapshotWithResult()`.
