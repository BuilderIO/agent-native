---
"@agent-native/toolkit": patch
---

`ShareButton` takes an `anchor` element for `hideTrigger`, so a share popover opened from a menu can sit beside the item it shares instead of the window corner. `normalizeCanvasHotkeyKey` from the canvas interactions entry reads a shortcut's letter from its physical key, so Option chords on macOS still match.
