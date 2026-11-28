---
"@agent-native/toolkit": patch
---

When text saved elsewhere changes a page, the editor now replaces only the changed characters, separately for each place that changed, so the cursor stays where it was and Undo still reverts earlier typing, both inside a paragraph whose words changed and in untouched text between two changes.
