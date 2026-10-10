---
"@agent-native/core": patch
---

Opening an agent chat thread no longer reads its full message history for the access check that runs when the thread opens and on each run poll. Access checks now read only the thread's sharing row, so opening a long thread transfers far less data from the database.
