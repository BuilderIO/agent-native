---
"@agent-native/core": patch
---

Reject empty or repeated `ownership`, `limit`, and `offset` query parameters and unsafe pagination integers before chat history list or search reads. Apply ownership and pagination defaults only when parameters are absent, while retaining the page-size cap for valid limits above 200.
