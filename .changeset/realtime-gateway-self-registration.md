---
"@agent-native/core": patch
---

Let apps outside the Builder hosting pipeline use the hosted Realtime Gateway.

Set `AGENT_NATIVE_REALTIME_TRANSPORT=hosted` on a Postgres-backed production
deploy that already has a `BUILDER_PRIVATE_KEY`, and the app registers its own
database and origin with the gateway on demand, then mints subscribe tokens against the
channel it gets back. The gateway URL is now derived from
`BUILDER_GATEWAY_BASE_URL` when unset, so hosted realtime needs one env var
instead of four. Pipeline-injected channels still win, and anything missing
(no key, a non-Postgres database, a deploy preview, the org not in the rollout)
leaves the app on its own `/_agent-native/poll`.

When the platform does not name this deploy's own URL (`DEPLOY_PRIME_URL` /
`DEPLOY_URL` / `URL`), registration additionally requires a platform runtime
marker — `NETLIFY`, `VERCEL`, `K_SERVICE`, `AWS_LAMBDA_FUNCTION_NAME` and the
like, not `NODE_ENV` — so a production build run on a laptop cannot repoint
production's channel at another database. A self-hosted deploy that sets
neither should set `URL` to its own origin; it logs why when it declines.
