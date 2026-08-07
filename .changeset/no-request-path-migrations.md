---
"@agent-native/core": patch
---

Stop running schema migrations on the serverless request path, and name every
database connection.

`runMigrations` now returns early in a production serverless request runtime.
The guard lives in the shared runner rather than at each call site: the
analytics template guarded its own runner, but `org`, `context-xray`, and
`observational-memory` kept calling `runMigrations` unguarded, so the
cold-start probe storm survived the fix meant to end it. Measured in
production: the schema snapshot alone costs 5.5-8.6s on a 180-table database,
with 4-6 copies running concurrently under load — and when it times out,
`ddl-guard` falls back to a per-object probe across ~390 call sites, so
starvation multiplies its own query count.

A scheduled or background runtime claims migration duty through
`withMigrationRuntime()`, and `runInServerlessRequest: true` remains the
explicit opt-in for a caller that cannot defer. The database client also
rejects unguarded schema DDL from production functions, so a new `ensureTable`
path fails loudly instead of quietly reintroducing the incident.

Better Auth table creation now lives in the framework's release migration
entrypoint, and Analytics' production deploy runs its framework and template
migrations once during the release build. No production request needs an
environment variable to skip schema work.

Postgres pools now set `application_name`. Every backend previously reported
`pgbouncer`, which made a 58 MB `SELECT id, config FROM dashboards` running
20-wide against production impossible to attribute — it appears nowhere in the
repo or any built bundle, and `pg_stat_statements` is not installed.
