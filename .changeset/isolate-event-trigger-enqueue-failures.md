---
"@agent-native/core": patch
---

Queue an event for every matching automation even when one of their queue writes fails. A single failed enqueue used to abort the fan-out, silently dropping the event for every later automation; each match is now attempted, and the failures are surfaced once with the first failing path.
