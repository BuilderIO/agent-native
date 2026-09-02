---
"@agent-native/core": patch
---

Re-check the stored `_collab_docs` version on every cached Y.Doc read, so a
serverless instance no longer serves collaboration text that a peer instance
moved past. `applyText` gains a `validateBase` hook for callers that need the
converged pre-diff text checked inside the write lock.
