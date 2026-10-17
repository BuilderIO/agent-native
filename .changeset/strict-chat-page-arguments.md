---
"@agent-native/core": patch
---

Reject invalid explicit pagination arguments in chat history client requests before fetching. List, search, and lifecycle requests share positive safe-integer limit and non-negative safe-integer offset validation; valid limits above 200 still reach the server for capping.
