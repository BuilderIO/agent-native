---
"@agent-native/toolkit": patch
---

`VisualScrubInput` keeps focus on Enter instead of blurring, and selects the
committed value the way Figma's inspector fields do. Blurring handed the next
keystroke to whatever global shortcut owned that key, so typing a value and
continuing to type could fire a canvas command (a zoom jump, in the report that
found this) while the user believed they were still editing the field.
