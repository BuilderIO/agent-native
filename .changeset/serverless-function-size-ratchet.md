---
"@agent-native/core": patch
---

Cut and ratchet serverless function payload size.

- Replace `better-sqlite3` with a throwing stub in serverless function bundles.
  Every consumer is gated on a `file:` or schemeless `DATABASE_URL`, and a
  function holding a file-backed SQLite database is already broken — the
  filesystem is ephemeral and each container gets its own copy. The stub drops
  the 1.9MB native binding from every emitted function and turns that
  misconfiguration into a loud, specific error instead of a silently empty
  database. Only the netlify, vercel and aws-lambda presets are affected; local
  development against a `file:` URL is unchanged.
- Run an app's `scripts/prune-serverless-functions.ts`, when it exists, as part
  of `agent-native build` rather than leaving it to be chained afterwards. The
  build's function size report and budget previously measured a directory that
  app-owned pruning then changed, reporting sizes up to 19MB above what
  actually shipped.
- Drop the orphaned dependency closure when the serverless browser runtime is
  pruned from a clone that can never run an agent turn. Deleting the two known
  directories left packages behind that existed only because
  `@sparticuz/chromium-min` or `playwright-core` needed them; the prune now
  walks the closure and removes what nothing still-present depends on.
