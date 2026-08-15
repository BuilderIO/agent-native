---
"@agent-native/core": patch
---

Keep a PPTX picture's own frame geometry when importing, so a portrait cropped to an `ellipse` or freeform frame renders inside that shape instead of as the hard square its bounding box happens to be.
