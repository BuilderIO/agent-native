---
"@agent-native/toolkit": patch
---

A registry block copied out of the editor keeps its source. `createRegistryBlockNode` writes the block's MDX source to `data-block-source` in its HTML and reads it back on parse, so a block pasted from the clipboard keeps its data and still saves, instead of arriving as an empty block that drops out of the document.
