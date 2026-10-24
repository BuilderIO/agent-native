---
"@agent-native/core": patch
---

Fall back to raw text when HTML extraction fails for malformed or parser-rejected HTML responses, instead of surfacing an internal post-processing error.
