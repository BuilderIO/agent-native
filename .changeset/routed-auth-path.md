---
"@agent-native/core": patch
---

Make authentication and public-route checks use the router's pathname, and refuse non-canonical request paths while preserving encoded route parameters.
