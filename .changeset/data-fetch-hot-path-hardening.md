---
"@agent-native/core": patch
---

Data-fetch hot-path hardening: faster loads, bounded hangs, fewer round trips.

- `useActionQuery` now threads React Query's per-fetch `AbortSignal` into the
  network request, so superseded fetches (key change, unmount, rapid refetch)
  actually cancel instead of holding a per-origin connection slot.
- Every action fetch is bounded by a 60s timeout (override via
  `callAction(..., { timeoutMs })`); a hung server surfaces a typed timeout
  error instead of an infinite spinner, and timeouts are not silently retried.
- Action query retries back off in ~0.5–2s steps instead of React Query's
  1s/2s/4s, so real failures surface in about a quarter of the time.
- Collaborative docs no longer open their own `EventSource` per doc (one for
  updates, one for awareness): they subscribe to the shared sync transport via
  the new `subscribeSyncEvents` API, so a tab holds exactly ONE SSE connection
  no matter how many docs are mounted — previously 3+ streams could starve the
  browser's per-origin connection budget and stall unrelated data fetches.
- Awareness (cursor/presence) events no longer trigger the framework-level
  query-invalidation sweep on every peer keystroke.
- The `/_agent-native/poll` fallback now backs off exponentially (cap 30s) on
  consecutive non-auth failures instead of hammering a down server at full
  cadence.
- Session org backfill and `getOrgContext` now share one per-request
  `org_members` lookup, and `getSetting`/`getUserSetting` reads are memoized
  per request — several DB round trips removed from every authenticated
  action call.
- Chat-thread share links resolve through a new indexed `share_token_hash`
  column (additive, with legacy-blob fallback + opportunistic backfill)
  instead of a `LIKE '%hash%'` scan over every thread's full message blob.
- Queued-message saves no longer pre-read the full thread blob a second time
  on every debounced composer write.
- The Drizzle non-Neon Postgres path gets the same per-op timeout +
  connection-error retry protection as every other Postgres path, and the
  Drizzle SQLite path now sets `busy_timeout` like the raw exec path.
- `agent_checkpoints` gains indexes on `(thread_id, created_at)` and `run_id`.
- Schema-prompt introspection coalesces concurrent cache-miss rebuilds;
  recurring-job runs no longer leak a live 5-minute backstop timer; a failed
  migration-connection open no longer poisons the shared exec singleton;
  `detachThread` no longer applies its optimistic update when the server
  rejects the change; `useAgentEngineConfigured` guards against out-of-order
  responses overwriting newer state.
