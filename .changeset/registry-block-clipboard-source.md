---
"@agent-native/toolkit": patch
---

A registry block copied out of the editor can keep its source. `createRegistryBlockNode` writes the block's MDX source to `data-block-source` in its HTML, and the new `readPastedSource` option reads a pasted block back from it: return the block as the app parsed it, or null to drop a source that isn't exactly the declared block. Without the option a pasted block keeps no source, as before.

Pasted HTML is now read only through the block's `data-*` attributes. A malformed block type drops the block, a malformed id is replaced with a fresh one, and HTML attributes named after the node's own attributes, such as `blockid` or `__raw`, no longer override them.
