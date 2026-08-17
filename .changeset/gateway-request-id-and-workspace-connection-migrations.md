---
"@agent-native/core": patch
---

Keep the gateway request id on agent-chat error captures, and create the
workspace connection tables at release time.

A Builder gateway error stop often arrives as one opaque user-facing sentence
carrying only an error id. The request id was captured only when the gateway
sent no message at all, so the errors that actually page had no key to join on
upstream. It now rides the stop event onto `EngineError` and out as a
`gatewayRequestId` tag (alongside `statusCode`) on the run-manager capture.

`workspace_connections`, `workspace_connection_grants`, and
`workspace_user_groups` existed only in their runtime `ensureTable` helpers.
Those are a no-op on a production serverless runtime by design, so
`workspace_user_groups` was never created in production and every read failed
with `relation "public.workspace_user_groups" does not exist`. They now have a
release migration.
