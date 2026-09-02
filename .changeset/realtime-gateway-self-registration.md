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

Registering an origin requires positive evidence that this process is the
deployment serving it, so a production build run on a laptop cannot repoint
production's channel at another database. A platform runtime marker counts
(`NETLIFY`, `VERCEL`, `K_SERVICE`, `AWS_LAMBDA_FUNCTION_NAME` and the like, plus
Netlify's per-deploy `DEPLOY_PRIME_URL` / `DEPLOY_URL`); `NODE_ENV` and the
generic `URL` deliberately do not, because both travel with a copied `.env`.

A self-hosted container or VM has no such marker and declares its origin
instead, with `AGENT_NATIVE_REALTIME_APP_URL`. That value wins over the resolved
self URL when set. Without either, registration declines and logs why.
