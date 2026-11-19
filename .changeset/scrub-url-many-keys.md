---
"@agent-native/core": patch
---

`scrubUrl` rebuilds the query and hash parameters in one pass, so a URL with thousands of distinct keys is scrubbed in milliseconds instead of seconds or minutes.
