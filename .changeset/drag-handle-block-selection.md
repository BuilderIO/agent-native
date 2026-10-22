---
"@agent-native/toolkit": patch
---

`Mod-d` duplicates a block the drag handle selected and selects the copy, and a click on the page outside the editor lets go of a selected block, which otherwise kept its outline after the editor lost focus. Clicks on buttons, menus, dialogs and toolbars keep the selection, since they may act on it.
