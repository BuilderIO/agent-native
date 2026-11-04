---
"@agent-native/core": patch
---

Export the collaboration outbox localStorage key prefixes from `@agent-native/core/collab/outbox-keys`, so tests and tools that look for unsent edits match every format the client reads.
