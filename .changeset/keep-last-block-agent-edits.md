---
"@agent-native/toolkit": minor
---

Keep a newer saved body's changes to a page's last block when an open editor merges it, instead of setting them aside because of the editor's own trailing empty line. Base-aware merges now report how many runs of the server's changed top-level blocks they set aside, through a new required `setAside` field on `planDocReconcile`'s `noop` and `applied` results and a new `onBaseAwareMerge` callback on `useCollabReconcile`. Code that builds those results itself, such as a test double, needs to add `setAside`.
