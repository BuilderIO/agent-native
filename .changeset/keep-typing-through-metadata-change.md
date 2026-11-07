---
"@agent-native/toolkit": patch
---

Keep an open editor's unsaved text when the page's timestamp moves but its body doesn't, as after a rename elsewhere. `useCollabReconcile` no longer treats that snapshot as newer than the doc, so it doesn't replace the doc with a body the editor already took in.
