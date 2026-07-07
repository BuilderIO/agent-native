---
"@agent-native/core": minor
---

Default agent SQL tools to read-only so app data writes go through typed actions unless raw write tools are explicitly enabled. Apps that intentionally rely on raw SQL writes must opt in with `databaseTools: "write"` (or `true`) to expose `db-exec` and `db-patch`.
