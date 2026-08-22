---
"@agent-native/core": patch
---

Stop a transient boot failure from permanently breaking sign-in. `getBetterAuth()` cached its init promise before that promise settled, so one failed
initialization — a busy SQLite file, a momentary pool error — was replayed as a rejection to every later caller for the life of the process, and the only
recovery was a restart. The failed attempt is now cleared so the next request re-initializes.

Also in the local-SQLite boot path: Better Auth opens the database through the shared `prepareLocalSqliteUrl()` / `sqliteFilenameFromUrl()` pair instead of
trimming the `file:` prefix by hand, so on serverless runtimes it lands on the same writable file as the app; and the `journal_mode = WAL` pragma is retried
on `SQLITE_BUSY` the way its documented sibling in `db/client.ts` already is.

Separately, the injected beta environment switcher opened its stylesheet with a bare `color-scheme: dark;` declaration. A declaration at stylesheet top level
is not a parse error that ends at its semicolon — the next qualified rule's prelude absorbs it, so `.environment-switcher` was dropped entirely and the badge
lost `position: fixed`, rendering in normal flow at the bottom-left of the page instead of pinned to the viewport corner.
