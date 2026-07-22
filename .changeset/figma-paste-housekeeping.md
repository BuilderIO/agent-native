---
"@agent-native/core": patch
---

Export shared Figma paint math (gradient geometry from transforms/handles,
blend-mode mapping, linear stop remapping) from `@agent-native/core/ingestion`
so the REST and `.fig`/clipboard import renderers derive gradients identically.
