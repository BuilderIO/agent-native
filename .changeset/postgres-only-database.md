---
"@agent-native/core": patch
"@agent-native/dispatch": minor
"@agent-native/creative-context": patch
"@agent-native/scheduling": patch
---

Standardize framework persistence on PostgreSQL. Local development uses PGlite,
hosted deployments use PostgreSQL, and the database client, schema, migrations,
templates, docs, and tooling now target PostgreSQL directly.
