---
"@agent-native/core": patch
---

Stop unnecessary re-renders driven by collaborative-doc awareness traffic and coalesce SSE-driven query invalidation. `useCollaborativeDoc`'s `activeUsers`/`agentPresent` now only produce a new identity when the deduped active-user set actually changes, instead of on every awareness broadcast (cursor jiggles, unchanged re-published presence state); `useDbSync` batches SSE/poll-driven `invalidateQueries` calls into at most one flush per 250ms instead of one per event.
