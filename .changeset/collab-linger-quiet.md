---
"@agent-native/core": patch
---

A collaborative document connection stops polling and pushing presence while it waits to be disposed, so switching away from a document that is then deleted no longer requests it and gets 404s.
