---
"@agent-native/core": patch
---

Map Figma's LINEAR_BURN blend mode to `multiply` instead of `plus-darker`, which Chromium does not support and silently drew as normal blending.
