---
"@agent-native/core": patch
---

Read agent SQL the way Postgres does before db-query, db-exec, and db-patch run it, and check in the transaction that every name resolves to the current user's scoped views. db-query now runs read-only. Adds `@agent-native/core/agent-sql` for apps that run agent-written SQL.

Adds `readAgentSqlQuery()` and `rewriteAgentSqlQuerySources()` for supported SELECT/WITH source names and exact text spans, and strengthens refusal of functions and operators outside `pg_catalog`, unsafe built-ins, and PostgreSQL escape-string continuation.
