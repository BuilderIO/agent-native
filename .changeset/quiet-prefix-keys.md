---
"@agent-native/core": patch
---

Escape application-state and resource prefix queries so literal `%` and `_` characters do not over-match keys. Also make core store initialization retry after transient failures instead of caching rejected promises, and keep run SSE polling moving past corrupt persisted events.
