---
"@agent-native/toolkit": patch
---

`Mod-d` duplicates a block the drag handle selected and selects the copy, and a click on the page outside the editor lets go of a selected block, which otherwise kept its outline after the editor lost focus. Clicks on buttons, menus, dialogs and toolbars keep the selection, since they may act on it.

`duplicateBlockTransaction` and `deleteBlockTransaction` build the edits the drag handle's Duplicate and Delete dispatch, so a block menu can ask the page's transaction filters about those exact edits before offering them.

An app menu opened from the drag handle now stays open on a touch screen while the keyboard opens for a field in it, such as a search box; the keyboard resizes and scrolls the page, which used to close the menu.

A click on the drag handle leaves its block selected while the menu is open. Ending the click used to rewrite the block's class attribute even though only a drag changes it, and ProseMirror read that back as a text selection, so the block lost its outline as the menu opened.
