---
"@agent-native/core": patch
---

Cut and ratchet serverless function payload size.

- Deny `better-sqlite3` from serverless function bundles. Every consumer is
  gated on a `file:` or schemeless `DATABASE_URL`, and a function holding a
  file-backed SQLite database is already broken — the filesystem is ephemeral
  and each container gets its own copy. Shipping the driver only turned that
  misconfiguration into a silently empty database instead of a loud failure.
  Local development against a `file:` URL is unaffected.
- Run an app's `scripts/prune-serverless-functions.ts`, when it exists, as part
  of `agent-native build` rather than leaving it to be chained afterwards. The
  build's function size report and budget previously measured a directory that
  app-owned pruning then changed, reporting sizes up to 19MB above what
  actually shipped.
