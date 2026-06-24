---
"@agent-native/core": patch
---

Fix agent chat failing on every prompt on long-lived Postgres/Neon databases
with `value "<ms epoch>" is out of range for type integer`. Millisecond
`Date.now()` timestamps are written into per-turn columns (`agent_runs`,
`agent_tool_ledger`, `chat_threads`, `application_state`, `token_usage`), but
databases created before the Postgres BIGINT compatibility shim had those
columns as 32-bit `INTEGER` (int4, max 2,147,483,647) — a millisecond epoch like
`1782269273204` overflows. The source had since switched to `BIGINT`, but
`CREATE TABLE IF NOT EXISTS` can't re-type an existing column, so old databases
kept the int4 column and `insertRun()` (which runs at the start of every turn)
failed, aborting the run as a `connection_error`.

Adds a `widenIntColumnsToBigInt()` helper that, on Postgres only, widens these
columns in place to `BIGINT` once via the stores' existing `ensureTable()`
bootstrap. It is idempotent (only ALTERs columns still typed `integer`, so
already-bigint tables are never rewritten), non-destructive (int4 → int8
widening), and a no-op on SQLite (whose `INTEGER` is already 64-bit).
