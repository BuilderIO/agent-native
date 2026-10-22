---
"@agent-native/toolkit": patch
---

Keep text and the caret in place when collaborative undo or redo crosses a block type change. Yjs merges the text it restores when a block's type change is undone, so a later undo of typing in that block deleted the rest of the block too; each undo now removes only what it inserted. The caret stays in its block instead of jumping to another heading, goes back to where it was when an undo replaces its block, and keeps its offset when a redo does. A collaborator's edit right after an undo no longer moves the caret.
