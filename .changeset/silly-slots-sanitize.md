---
"@agent-native/core": patch
---

Fix a recurring `DataCloneError` console error when any embedded extension (Design's Tools/Extensions panel, or any other app using `EmbeddedExtension`) loads or its slot context updates. Slot contexts commonly carry live callback functions the host uses internally; `postMessage`'s structured clone algorithm throws on function-valued properties, so the context update silently never reached the extension iframe. Sanitize the context through a JSON round-trip (dropping functions) before posting it.
