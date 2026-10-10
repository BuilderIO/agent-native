---
"@agent-native/core": patch
---

`pnpm db:migrate` in the Builder Code starter now runs `agent-native db-migrate`,
which reads `drizzle.config.ts` and applies migrations through the running local
dev server when the database is PGlite instead of opening the data directory from a second process and
corrupting it. `createDrizzleConfig` also refuses `drizzle-kit migrate`, `push`,
`studio`, and `pull` against a PGlite directory held by a live dev server.
