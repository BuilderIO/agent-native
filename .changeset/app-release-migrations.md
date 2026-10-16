---
"@agent-native/core": patch
---

Starter apps (chat and the default scaffold) now apply their own `server/plugins/db.ts` migrations in `migrate:production` through the new `runAppReleaseMigrations()`. A release-owned deploy skips that plugin at boot, so before this the app's tables were never created in production. Projects with a Drizzle config keep applying their tables with `db:migrate`.
