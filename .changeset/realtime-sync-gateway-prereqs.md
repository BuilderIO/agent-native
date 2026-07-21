---
"@agent-native/core": minor
---

Realtime sync: make the change-notification read path multi-app instanceable so a hosted gateway can tail many apps from one process.

- Refactor `poll.ts` into an `AppSyncState` class holding all previously module-global state (version counter, ring buffer, poll emitter, watermarks, and the access cache). Module-level exports (`recordChange`, `getVersion`, `getPollEmitter`, `getChangesSinceForUser`, `canSeeChangeForUser`, `createPollHandler`, `invalidateCollabAccessCache`) now delegate to a lazily-created default instance bound to the process DB, so self-hosted apps are unchanged.
- `AppSyncState` accepts an injected DB accessor, Postgres check, and access resolver, and exposes `getCombinedChangesSinceForUser`/`checkExternalDbChanges`/`persistSyncEvent` for reuse.
- Add `readMinSyncEventVersion()` (oldest retained durable version) so consumers can detect a reconnect cursor that predates the 24h retention window.
- Add an opt-in `deterministicEventIds` mode that derives durable-event ids from an event's logical identity plus a stable dedupe signal (excluding the per-instance version), so multiple processes detecting the same out-of-band write collapse to one row via `ON CONFLICT (id) DO NOTHING`. Off by default; single-writer apps keep the historical random-suffix ids.
- `createPollEventsHandler` accepts an optional `AppSyncState`.
