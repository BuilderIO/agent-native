---
"@agent-native/core": patch
---

`scrubUrl` drops `user:password@` from a URL it cannot parse, so a malformed address no longer keeps its credentials when the query and hash are removed.
