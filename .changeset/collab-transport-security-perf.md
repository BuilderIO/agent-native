---
"@agent-native/core": minor
---

Real-time collaboration improvements: security scoping, server performance, and client transport.

**Security**
- Tag collab poll events with `owner`/`orgId` when `resourceType` is configured so `getChangesSinceForUser` scopes delivery — users without access no longer receive Yjs bytes.
- Awareness routes (`POST /awareness`, `GET /users`) already required a session; they now additionally enforce the configured resource access check.
- Add a one-time server warning when `resourceType` is not set (collab events broadcast to all authenticated users).
- Enforce a 2 MB payload limit on all collab write endpoints (`/update`, `/text`, `/search-replace`, `/json`, `/patch`); configurable via `maxPayloadBytes` plugin option.
- Fix awareness outer-map memory leak: prune empty per-doc maps after all clients expire.

**Server performance**
- Remove redundant double DB read per mutation. The old code called `applyStoredState()` unconditionally before every write even on hot-cache hits; mutations now do a single SELECT inside `persistMergedState` (for CAS versioning only).
- Add Yjs tombstone compaction: when the persisted blob is >4× the freshly encoded state, the GC'd form is stored, preventing unbounded blob growth without background jobs.
- Cache-miss coalescing: concurrent `getDoc()` callers share a single DB load.

**Client transport**
- Debounce and coalesce local Yjs update POSTs (~80 ms) using `Y.mergeUpdates`; flush immediately on `visibilitychange`/`pagehide` and before each poll cycle.
- State-vector fetches are gated: fetch only on reconnect, ring-buffer gap, or every 15th cycle (not on every cycle).
- Exponential backoff with jitter (cap ~15 s) on consecutive network errors.
- SSE fast-path: wire collab events via the existing `/_agent-native/poll-events` EventSource stream; relax poll to ~12 s while SSE is healthy, fall back to 2 s when SSE drops.
