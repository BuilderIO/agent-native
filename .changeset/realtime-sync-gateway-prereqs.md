---
"@agent-native/core": minor
---

Realtime sync: framework prerequisites for the hosted Realtime Sync Gateway. All new behavior is opt-in — apps without hosted-realtime config are unchanged.

- Refactor `poll.ts` into an `AppSyncState` class holding all previously module-global change-tracking state (version counter, ring buffer, poll emitter, watermarks, and the access cache). Module-level exports (`recordChange`, `getVersion`, `getPollEmitter`, `getChangesSinceForUser`, `canSeeChangeForUser`, `createPollHandler`, `invalidateCollabAccessCache`) delegate to a lazily-created default instance bound to the process DB, so self-hosted apps are unchanged. `createPollHandler` and `createPollEventsHandler` accept an optional injected `AppSyncState`.
- `AppSyncState` accepts an injected DB accessor, Postgres check, and access resolver, and exposes `getCombinedChangesSinceForUser`/`checkExternalDbChanges`/`persistSyncEvent` for reuse. `ddl-guard` helpers accept a `dialectIsPostgres` override so injected per-app clients get the guarded Postgres DDL path regardless of the process-global DB.
- The per-user access cache key now includes the active `orgId`, so a decision cached in one org is never reused under another org's session.
- Add `readMinSyncEventVersion()` (oldest retained durable version) for stale-cursor detection, and an opt-in `deterministicEventIds` mode so multiple processes detecting the same out-of-band write collapse to one durable row. Both off/unused by default.
- New public export subpaths: `./server/poll`, `./server/sse`, `./server/short-lived-token`.
- New realtime subscribe tokens: `signRealtimeSubscribeToken`/`verifyRealtimeSubscribeToken` — per-project HMAC key, identity-bearing claims (`owner`/`orgId` required), `projectId` channel binding, and a `typ` discriminator so they are not interchangeable with media tokens. Existing `signShortLivedToken`/`verifyShortLivedToken` are untouched.
- New session-gated, same-origin endpoint `GET /_agent-native/realtime-token` mounted by core-routes. Fail-closed: responds 404 unless the app is provisioned with a per-project signing secret (`AGENT_NATIVE_REALTIME_HMAC_SECRET`) and a Builder project id; responses are `Cache-Control: private, no-store`.
- New shared realtime wire protocol (`realtime-protocol.ts`, re-exported from `./server/sse`): named SSE `handshake`/`token` control frames; data/batch frames unchanged.
- Client transport (`useDbSync`/`subscribeSyncEvents`) gains an opt-in hosted-gateway mode, enabled only when the SSR config sets `realtime.transport = "hosted"` with an explicit gateway URL: token mint/rotation, jittered reconnects, and automatic health-gated fallback to the app's own `/poll` + `/events`. `onSseStateChange` callbacks now also receive the negotiated capability list (optional second parameter; existing callbacks are unaffected), which collab uses to keep its fast presence cadence on `no-awareness` streams.
