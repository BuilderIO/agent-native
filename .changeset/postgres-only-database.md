---
"@agent-native/core": patch
"@agent-native/dispatch": minor
---

Standardize framework persistence on PostgreSQL. Local development uses PGlite,
hosted deployments use PostgreSQL, and the database client, schema, migrations,
templates, docs, and tooling no longer expose alternate backend support.
