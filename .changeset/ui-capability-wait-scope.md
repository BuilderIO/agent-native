---
"@agent-native/core": patch
---

A UI action call waiting on another session's capability mint now stays bound to the session scope it started in, and removes its abort listener once aborted.
