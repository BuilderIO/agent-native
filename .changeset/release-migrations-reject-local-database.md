---
"@agent-native/core": patch
---

Fail a production release migration that resolves to a local database instead of
silently migrating a throwaway file. The deploy step exports
`AGENT_NATIVE_RUN_RELEASE_MIGRATIONS=1`; when `DATABASE_URL` is unset or local in
that step, migrations were applied to a SQLite file inside the build container,
logged `Applied migration ...`, and exited 0 — so the deploy published green
while the deployed functions kept using a remote database that never received
the schema.
