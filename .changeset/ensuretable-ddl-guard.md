---
"@agent-native/core": patch
---

Guard on-demand `ensureTable()` schema-init so the already-migrated path takes no
`ACCESS EXCLUSIVE` lock on Postgres. The app-secrets (`app_secrets`) and `settings`
stores now probe `information_schema`/`pg_indexes` first (plain reads, no lock) and
issue `CREATE`/`ALTER`/`CREATE INDEX` only when something is actually missing; any
DDL that must run is wrapped in a transaction-scoped `SET LOCAL lock_timeout` so a
contended lock fails fast instead of hanging (and never leaks onto the pooled
connection). This fixes background-function workers hanging indefinitely on
first-touch schema DDL behind a concurrent connection on shared Neon — observed as
durable agent-chat workers stalling right after auth and never claiming the run.
SQLite (local dev) behavior is unchanged. Adds a shared `db/ddl-guard.ts` helper
(`pgTableExists`/`pgColumnExists`/`pgIndexExists`/`runGuardedDdl`). Also adds
diagnostic-only worker setup sub-stage breadcrumbs to localize such stalls.
