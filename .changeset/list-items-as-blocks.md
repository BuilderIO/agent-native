---
"@agent-native/toolkit": patch
---

`DragHandle` takes a `listItems` option that gives each item of a bulleted, numbered or to-do list its own grip, menu and drag, with drops between items and out of a list, and Mod-D and Mod-Shift-arrow keys for the item at the caret. It's off by default. The helpers it uses, such as `moveBlockTransaction` and `insertBlockAt`, are exported from `@agent-native/toolkit/editor`.
