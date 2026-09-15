---
"@agent-native/toolkit": patch
---

Reserve a minimum gap between a menu item's label and its shortcut hint in `ContextMenuShortcut`, `DropdownMenuShortcut`, and `MenubarShortcut`. Previously the shortcut relied solely on an auto margin to push itself to the right edge, which collapses to zero when the menu's width is sized to fit its own widest row (e.g. "Send backward ⌘↓" in the Slides layer-order context menu), crowding the label and shortcut together.
