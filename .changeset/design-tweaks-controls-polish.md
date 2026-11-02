---
"@agent-native/toolkit": patch
---

Scrub inputs show and commit at most two decimals when a field sets no `precision`, so float noise from the browser no longer reaches the field. `VisualColorPicker` takes `textColor` to draw its swatch as a bold "A" over a bar in the picked color, and its menu caret is a Tabler chevron.
