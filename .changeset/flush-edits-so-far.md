---
"@agent-native/core": patch
---

`useCollaborativeDoc`'s `flushUpdates({ editsSoFar: true })` waits only for the edits made before the call. A save that took its text first can send once those reach the server, even while someone keeps typing on a slow connection; plain `flushUpdates()` still waits until no edit is outstanding.
