---
"@agent-native/toolkit": patch
---

The editor drag handle's app menu request has `insertAbove()`, which adds an empty paragraph above the block with the caret in it. A menu in a dialog, such as a phone's bottom sheet, now stays open when the on-screen keyboard resizes the page, as a menu with `role="menu"` already did.
