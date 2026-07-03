---
"@agent-native/core": minor
---

Add `ensureAdditiveColumns` (`@agent-native/core/db`), a boot-time helper that diffs each Drizzle table's declared columns against the live database and additively `ALTER TABLE ... ADD COLUMN`s any that are missing. This closes the gap where a column added to a Drizzle schema without a matching hand-written migration silently 500s every query on pre-existing production tables (fresh dev databases don't show the bug because `CREATE TABLE IF NOT EXISTS` always includes new columns). It only ever adds missing columns — never drops, renames, or retypes existing ones — skips `NOT NULL` columns with no safe backfill default, and is wired into the analytics template's `server/plugins/db.ts` after its authoritative migrations run.
