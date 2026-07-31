---
"@agent-native/core": patch
---

Share one Postgres connection pool per URL across the whole process instead of
building a separate one for the `getDbExec` singleton, Better Auth, and every
`createGetDb` store. Against a remote database that removed five redundant
first-connect round trips per process, and it let the pool cap rise so a
request's concurrent reads no longer serialize behind a single connection.
Secret reads are now memoized per request, keyed on scope and scope id, so the
user/org/workspace credential waterfall is not re-walked on every lookup.
Onboarding step status, resource inheritance layers, and feature-flag rules now
resolve their independent reads concurrently.
