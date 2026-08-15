---
"@agent-native/core": patch
---

Keep post-turn Observational Memory compaction alive on serverless hosts. The pass is issued after the turn's `done` event and has to finish a streaming model call before it writes, so on a host that freezes the isolate once the response settles the unregistered promise was simply killed and the thread never accrued the memory that would have spared the next turn. It now registers with the request's `waitUntil` when the platform provides one; long-lived hosts keep the existing fire-and-forget behavior.
