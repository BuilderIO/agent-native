---
"@agent-native/core": patch
---

Stop collaborative document polling when the final subscriber leaves, and restart it if the document is mounted again during the connection reuse window.
