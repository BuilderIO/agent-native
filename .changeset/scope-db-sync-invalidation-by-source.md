---
"@agent-native/core": patch
---

Stop `useDbSync` from turning app-state navigation/selection churn into a client fetch storm. `app-state` change events (agent/UI navigation, selection, and the set-url/questions command channel) now only invalidate their own `["app-state"]` and command query keys — they no longer fan out into the broad `["action"]`, `["extension"]`, and `["tool"]` data-query invalidation. Only events that can actually change action/extension-backed data (action mutations, settings, extensions, collab, screen-refresh) refetch those prefixes.

During an active agent session the app mirrors navigation and selection into `application_state` continuously, and on serverless the poll fallback replays those writes back to the originating tab (the DB-scan path can't preserve `requestSource`, so `ignoreSource` can't filter them). Each replayed write previously refetched every action query at once, and that request storm exhausted the DB connection pool — which starved run heartbeat writes and surfaced downstream as `stale_run` chat errors. Real mutations that also write navigation state still refresh action queries because their `action` event rides in the same batch.
