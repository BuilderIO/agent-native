---
"@agent-native/core": patch
---

`createDrizzleConfig` accepts a `url` option that takes precedence over `DATABASE_URL` and `<APP_NAME>_DATABASE_URL`, so an app can point drizzle-kit at a direct database endpoint while the app itself keeps querying through a pooler. A Neon pooler is PgBouncer in transaction mode and cannot run migration DDL. A blank or unset `url` still falls back to the environment, so `url: process.env.DATABASE_URL_UNPOOLED` is correct on hosts that set only `DATABASE_URL`.
