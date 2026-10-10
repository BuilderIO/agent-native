---
"@agent-native/agentkit": minor
"@agent-native/core": patch
---

Expose server-confirmed chat persistence, report snapshot save results, and allow canceled persistence requests so the UI can retry failed saves safely. The legacy `persistThreadSnapshot()` method rejects on unexpected transport failure and resolves for expected cancellation or queue deferral without confirming that the snapshot was saved. Use `persistThreadSnapshotWithResult()` when callers need the save outcome.
