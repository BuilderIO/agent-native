---
"@agent-native/core": patch
---

Attribute Builder agent branches to the requesting user instead of the connected credential's `BUILDER_USER_ID`, falling back to that user only when the caller's email is not a Space member.
