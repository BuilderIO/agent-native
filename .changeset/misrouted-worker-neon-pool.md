---
"@agent-native/core": patch
---

Stop misrouted agent-chat workers from taking the large background Neon connection pool. `isBackgroundFunctionPoolContext()` no longer trusts the dispatch marker (`__AGENT_NATIVE_BACKGROUND_RUNTIME_EXPECTED__`) — a worker dispatched toward a `-background` URL but routed onto the ~60s synchronous function would otherwise open the 8-connection worker pool while running as one of many warm sync-function instances, exhausting the Neon pooled endpoint (connection terminated / statement timeouts / failed heartbeat writes surfacing as stale runs). Only the genuine `-background` runtime marker (set at cold start) unlocks the larger pool now, mirroring the same proof-of-landing tightening applied to the worker soft-timeout.
