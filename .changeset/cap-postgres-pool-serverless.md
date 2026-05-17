---
"@agent-native/core": patch
---

Cap the Postgres connection pool to a single connection per instance on serverless runtimes (Netlify Functions / AWS Lambda). Concurrent frozen Lambda instances each holding postgres.js's default 10-connection pool were exhausting Neon/Postgres' connection limit, causing "Max client connections reached" and HTTP 500s on every `/_agent-native/*` route. Long-lived Node servers keep the normal pool.
