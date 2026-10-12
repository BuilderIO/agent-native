---
"@agent-native/core": patch
---

Send an action query's first fetch as its own request and batch only refetches of data already on screen, so a fresh page load no longer waits behind unrelated reads queued on one serverless database connection.
