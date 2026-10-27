---
"@agent-native/core": patch
---

Add `loadAwarenessRowsWith`, which reads a document's presence through a given database client, such as an open transaction, so a serverless pool's one connection isn't needed twice.
