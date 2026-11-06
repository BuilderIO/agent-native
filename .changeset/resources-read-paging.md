---
"@agent-native/core": patch
---

The `resources` tool `read` action now accepts `offset` and `length` and pages resources larger than 40,000 characters, with a header showing whether the read is partial and the next offset.
