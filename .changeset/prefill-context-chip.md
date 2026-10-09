---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

`sendToAgentChat({ submit: false, context })` no longer writes the raw `<context>` block into the composer draft. The context attaches to the next submit instead, shown as a chip labeled by the new `contextLabel` option, or with no chip when it is omitted.
