---
"@agent-native/core": patch
---

Cut idle database round trips on serverless deployments.

- The Netlify keep-warm scheduled function is now opt-out and its cadence configurable (`AGENT_NATIVE_DISABLE_KEEP_WARM`, `AGENT_NATIVE_KEEP_WARM_SCHEDULE`), and the expensive background-function warm can be dropped on its own (`AGENT_NATIVE_DISABLE_KEEP_WARM_BACKGROUND`). Previously a once-a-minute wake was hardcoded, so a scale-to-zero database (Neon, Aurora Serverless v2, paused-compute Supabase) never autosuspended and burned its compute quota with zero users online. Defaults are unchanged; an unparseable cron fails the build rather than silently reverting to the old cadence.
- Thread ACL checks no longer load the conversation blob. `resolveThreadAccess` was loading the full `chat_threads` row — including `thread_data` — for the access decision, discarding it, and reading the same row again, so every agent-chat request downloaded the conversation twice. The share dialog and collab routes got the same projected-load fix.
- The SQL-backed SSE relay now backs off from 500ms toward 2s after a run has been quiet for several polls, and probes `reapIfStale` on its own 5s cadence instead of the 500ms status cadence — a reap cannot match a row younger than 15s, so it was issuing ~30 rounds of round trips before it could do anything. Streaming cadence is unchanged.
- The in-process backstop sweep timers can be turned off with `AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS` where a durable scheduler already drives the same recovery. On serverless these timers run per warm container, so their query rate scaled with instance count rather than with load.
- Domain auto-join no longer probes `organizations` on every authenticated request. It short-circuits free email providers (which can never match, since an org may not claim one as its `allowed_domain`) and caches a no-match per domain, invalidated when `allowed_domain` is written. Previously this ran once per request for every account not already in a domain-matched org, with no fixed point.
- Session-token and org-membership resolution are cached across requests behind short TTLs plus write invalidation, instead of one round trip each per request. `getAllSettings` is memoized per request and now seeds the single-key settings cache.
- Added `shared/ttl-cache.ts` as the single bounded-TTL cache primitive and moved the hand-rolled one in `triggers/condition-evaluator.ts` onto it. Failed reads are never cached anywhere, so an unreadable table can't be served as "absent".
