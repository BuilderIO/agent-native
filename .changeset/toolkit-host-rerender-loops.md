---
"@agent-native/toolkit": patch
---

Chat and composer pieces no longer make large host editors re-render in a loop: a closed file storage setup popover stops measuring its anchor on every render, and the assistant chat reports its message count only when the count changes.
