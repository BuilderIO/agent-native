---
"@agent-native/core": patch
---

Keep an agent run alive when its execution lease lapses without being replaced. A database call or event loop that stalls for more than 15 seconds no longer ends the run without a reason and later shows it as "The agent stopped before finishing". Lease renewals also time out and retry instead of blocking every later heartbeat.
