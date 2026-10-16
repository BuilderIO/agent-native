---
"@agent-native/core": patch
---

Reject empty or repeated chat history query parameters and unsafe pagination integers before list or search reads. Apply ownership and pagination defaults only when parameters are absent, while retaining the page-size cap for valid limits above 200.
