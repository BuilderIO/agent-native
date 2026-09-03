---
"@agent-native/core": patch
---

`/_agent-native/health?strict=1&schema=1` no longer reports a deploy healthy
when it silently fell back to a local SQLite file, and its schema probe now
covers Better Auth's own tables. `runDatabaseSchemaHealthCheck` requires
`user`, `session`, `account`, `verification`, and `jwks` whenever auth is
enabled (skipped only when `AUTH_DISABLED` is set), so a missing `jwks` table
now shows up as `schema.ok: false` instead of only surfacing as a 500 on the
Better Auth route. The response also carries an additive `auth` object
(`baseUrlHost`, `requestHost`, `hostMismatch`) so a probe can tell a
configured production host apart from the host actually being served.

`getDbExec()` now throws a typed `HostedRuntimeLocalDatabaseError` instead of
silently opening `file:./data/app.db` when a hosted function invocation (not
a Netlify build step, which also sets `NETLIFY=true`) resolves no database
URL — a serverless instance's local filesystem is ephemeral and per-instance,
so this was a deploy that looked green while quietly running on throwaway
data.

Adds `scripts/smoke-check-health.ts`, used by the prebuilt Netlify deploy
workflow's smoke-test step to assert the health body (readiness, dialect,
schema, and — for production — the host match) instead of only the HTTP
status code, and to check the Better Auth `jwks` route returns real keys.
