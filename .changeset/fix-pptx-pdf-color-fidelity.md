---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fix PPTX/PDF import color and text fidelity: resolve theme/master colors (including `lumMod`/`lumOff`/`tint`/`shade` transforms) instead of defaulting to black, inherit per-level placeholder colors from the slide master, resolve each slide's own layout→master→theme chain instead of reusing the deck's first master (fixes wrong colors in presentations combining more than one template), recover per-run text colors and styles from PDF content streams instead of collapsing multi-color/multi-weight lines to a single style, treat a PDF's initial (unset) fill color as the known black default instead of an unresolved guess, preserve real PDF line spacing for bullet lists, bound concurrent PDF page image uploads, and fail clearly instead of silently importing a scanned/unrecoverable PDF as blank placeholder slides.
