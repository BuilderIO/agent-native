---
"@agent-native/core": patch
---

A chat thread that its first run has not saved yet now reads as a typed `{ absent: true }` state for clients that send the `x-agent-native-thread-absence: typed` header, so a new chat's first snapshot and title saves no longer log 404s before creating the thread.
