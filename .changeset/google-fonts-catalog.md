---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

`@agent-native/core/server` reads Google's public font catalog with `readGoogleFontCatalog`, listing every family with the weights and italics it ships, most popular first. The toolkit font picker searches that whole library, previews each family in its own face, and loads any catalog family on the canvas through `ensureGoogleFontStylesheets`.
