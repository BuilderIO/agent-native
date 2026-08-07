---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fix PPTX/PDF import color and text fidelity: resolve theme/master colors (including `lumMod`/`lumOff`/`tint`/`shade` transforms) instead of defaulting to black, inherit per-level placeholder colors from the slide master, recover per-run text colors and styles from PDF content streams instead of collapsing multi-color/multi-weight lines to a single style, preserve real PDF line spacing for bullet lists, and bound concurrent PDF page image uploads.
