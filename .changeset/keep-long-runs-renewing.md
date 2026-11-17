---
"@agent-native/core": patch
---

Stop long agent runs from losing their execution lease while a tool is still running. A heartbeat renewal that hangs on a dead database connection is now abandoned after its deadline so the next tick can retry, instead of two hung renewals ending renewal for the rest of the run. A run that does lose its lease now says the server lost track of it and that its partial output is kept.
