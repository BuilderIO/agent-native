---
"@agent-native/core": patch
---

Make the credential redaction used on error messages and stack traces run in linear time, so a long run of repeated key-like text can no longer stall the process that redacts it.
