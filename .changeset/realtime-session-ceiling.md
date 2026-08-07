---
"@agent-native/core": patch
---

Bound how long a hosted realtime stream can outlive the session that authorized it. Subscribe tokens now carry an optional `absExp` ceiling that `verifyRealtimeSubscribeToken` enforces independently of `exp` (rejecting with `session_expired`), and the mint endpoint sets it to 15 minutes. The gateway re-signs a stream's token every few minutes without consulting the app, so previously one mint could be extended indefinitely and logout, session expiry, user deletion or org removal never reached an open stream. Rotation must copy `absExp` verbatim and refuse to rotate past it.

`AppSyncStateOptions` also gains `accessAllowTtlMs` (default 30s). `invalidateCollabAccessCache` only reaches the in-process default instance, so a gateway holding per-app instances cannot be told a share was revoked and keeps serving its cached ALLOW until the TTL lapses; a shorter value bounds that window at the cost of more `can-see` round-trips.
