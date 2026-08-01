---
"@agent-native/core": patch
---

Run an app on Cloudflare's own SQL dialect end to end. The Worker module preset
writes a `DB` D1 binding into the generated `wrangler.json` when
`CLOUDFLARE_D1_DATABASE_NAME` and `CLOUDFLARE_D1_DATABASE_ID` are set at build
time, and Better Auth gains a D1 branch so accounts and sessions live in the
same database as app data. Previously the auth adapter fell through to
`better-sqlite3` on D1 and failed inside that package's fail-closed Worker stub
with "is not a constructor", naming neither the binding nor the dialect. The
sign-in page also reported the connection as a local SQLite file on D1.
