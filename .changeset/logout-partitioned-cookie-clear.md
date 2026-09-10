---
"@agent-native/core": patch
---

Clear framework auth cookies from the CHIPS partition they were set in, so logout cannot leave a live session cookie behind, and re-resolve the client session when a request comes back 401 instead of painting a generic load error.
