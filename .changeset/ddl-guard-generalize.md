---
"@agent-native/core": patch
---

Generalize the `ensureTable()` DDL guard to ALL on-demand schema-init paths
(~36 stores: agent run-store, application-state, chat-threads, usage,
oauth-tokens, resources, observability, integrations, provider-api, mcp,
workspace-connections, extensions, audit, harness, a2a, notifications,
browser-sessions, auth/sessions, agent-teams run-queue, better-auth, and more).

Every `ensureTable` now probes `information_schema`/`pg_indexes` before issuing
`CREATE TABLE`/`ALTER TABLE ADD COLUMN`/`CREATE INDEX`, so the already-migrated
hot path takes NO `ACCESS EXCLUSIVE` lock on Postgres. Any DDL that must run is
wrapped in a transaction-scoped `SET LOCAL lock_timeout` (never leaks onto the
pooled connection), and a swallowed lock-timeout triggers a RE-PROBE: if the
schema is still missing it throws (so the per-store init memo rejects and retries)
rather than memoizing init success against absent schema. This fixes
background-function (durable agent-chat) workers hanging indefinitely on the
first-touch DDL lock of any table on shared Neon. Shared helpers live in
`db/ddl-guard.ts` (`ensureSchemaObject`/`ensureTableExists`/`ensureColumnExists`/
`ensureIndexExists`). SQLite (local dev) behavior is unchanged. CREATE SQL that
references `intType()` is built at runtime, not module scope.
