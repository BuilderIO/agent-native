---
"@agent-native/core": patch
---

Fix `value "<ms epoch>" is out of range for type integer` on long-lived
Postgres/Neon databases — most visibly, agent chat failing on **every** prompt.
Millisecond `Date.now()` timestamps are written into columns that, on databases
created before the Postgres BIGINT-compatibility shim, are physically 32-bit
`INTEGER` (int4, max 2,147,483,647); a millisecond epoch like `1782269273204`
overflows. The source had since switched to `BIGINT`, but `CREATE TABLE IF NOT
EXISTS` can't re-type an existing column, so those databases kept the int4
column and writes kept failing (`insertRun()` runs at the start of every turn,
so the agent chat aborted as a `connection_error`).

Adds a `widenIntColumnsToBigInt()` helper (new module
`@agent-native/core/db/widen-columns`) that, on Postgres only, widens such
columns in place to `BIGINT` once via each store's existing `ensureTable()`
bootstrap. It is idempotent (only ALTERs columns still typed `integer`, so
already-bigint tables are never rewritten), non-destructive (int4 → int8
widening), and a no-op on SQLite. Applied to the millisecond-timestamp columns
of `agent_runs`, `agent_tool_ledger`, `chat_threads`, `application_state`,
`token_usage`, `settings`, `oauth_tokens`, `resources`, `sessions`, and
`custom_api_providers`. (`staged_datasets` already self-heals via its own
widener.)
