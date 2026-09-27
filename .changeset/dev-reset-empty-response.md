---
"@agent-native/core": patch
---

In dev, a connection reset from a server-side socket now returns an error response and is logged, instead of closing the browser's request with an empty response.
