---
"@agent-native/toolkit": patch
---

`useCollabReconcile` takes an optional `isEditorClean(liveMarkdown)` from the host. When the host reports the live document holds no unsaved text, a lead client adopts a newer snapshot right after the catch-up sync instead of waiting out the 2.5 s peer settle. Hosts that leave it unset keep the wait.
