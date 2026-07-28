---
"@agent-native/core": patch
---

Warn in the `update-extension` tool description against inlining large static datasets into extension HTML/JS and against oversized single edit/replace payloads, since a payload over roughly 8KB risks the model truncating its own `payloadJson` mid-generation and arriving as an empty or malformed call that stalls the run.
