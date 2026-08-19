---
"@agent-native/core": patch
---

Create every framework-owned table at release time, so a hosted deploy comes up with a complete database.

Most framework tables are defined by their owning store's `ensureTable()`, not by a migration list — `settings`, `application_state`, `app_secrets` and `resources` among them. On a long-lived server the first request creates whatever is missing. On production serverless it cannot: `schemaEnsureDisabled()` reports every table present so a cold start skips ~390 probes, which is correct for latency and means nothing on the request path can create a table. Only 15 of ~75 framework tables had a migration list, so the other 60 had no path to creation at all on a hosted deploy. Sites published successfully and then failed every request with `relation "public.settings" does not exist`.

`runFrameworkReleaseMigrations` now runs those stores' own ensure paths first, from an explicit list in `server/release-schema.ts`, and `schemaEnsureDisabled()` no longer applies to a caller holding migration duty — the release step was subject to its own skip, because the Netlify build environment also sets `NETLIFY=true`.

A new `guard:release-schema-complete` fails the build when a module calls `ensureTableExists` and is not in that list, so a new store cannot repeat this. The migration-duty check moved to `db/migration-runtime.ts` to keep it off `db/client.js`, which stores mock.

Already-published sites need one redeploy to pick up the missing tables.
