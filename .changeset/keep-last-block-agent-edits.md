---
"@agent-native/toolkit": patch
---

Keep a newer saved body's changes to a page's last block when an open editor merges it, instead of setting them aside because of the editor's own trailing empty line. Base-aware merges now report how many server changes they set aside, through `setAside` and a new `onBaseAwareMerge` callback on `useCollabReconcile`.
