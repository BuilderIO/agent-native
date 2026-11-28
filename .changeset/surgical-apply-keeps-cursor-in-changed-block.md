---
"@agent-native/toolkit": patch
---

When text saved elsewhere changes words inside the paragraph being edited, the editor now replaces only the changed characters, so the cursor stays where it was and Undo still reverts earlier typing in that paragraph.
