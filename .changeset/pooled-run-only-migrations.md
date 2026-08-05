---
"@agent-native/core": patch
---

Keep run-only database migrations on the shared pool so serverless cold starts do not open an unnecessary direct Postgres connection.
