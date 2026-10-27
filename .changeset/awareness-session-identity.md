---
"@agent-native/core": patch
---

A collaborator whose session can't edit the document now always advertises `canFlushDocument` and `canFlushTitle` as false in awareness, whatever its client sent.
