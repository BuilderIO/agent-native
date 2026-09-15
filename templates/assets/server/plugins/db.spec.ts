import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as schema from "../db/schema";

/**
 * Regression guard mirroring the analytics template's db.spec.ts (see
 * templates/analytics/server/plugins/db.spec.ts): a column added to
 * schema.ts without a matching `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
 * migration in db.ts silently 500s every query touching a pre-existing
 * production table, because `CREATE TABLE IF NOT EXISTS` is a no-op once the
 * table already exists.
 *
 * This walks every Drizzle table exported from schema.ts and asserts every
 * declared SQL column name appears somewhere in the migrations source
 * (db.ts) — either in the table's original `CREATE TABLE` or in a later
 * `ADD COLUMN` migration. It can't prove *ordering* (a column could still be
 * referenced only in a comment), but it catches the exact failure mode here:
 * a schema column with zero mentions in the migration history.
 */

const dbTsSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

interface DrizzleColumn {
  name: string;
}

interface DrizzleTable {
  [column: string]: unknown;
}

function isDrizzleTable(value: unknown): value is DrizzleTable {
  return (
    !!value &&
    typeof value === "object" &&
    // Drizzle tables carry a Symbol-keyed metadata bag; plain exports (types,
    // functions) don't.
    Object.getOwnPropertySymbols(value).some((s) =>
      s.toString().includes("drizzle"),
    )
  );
}

function columnsOf(table: DrizzleTable): DrizzleColumn[] {
  return Object.values(table).filter(
    (v): v is DrizzleColumn =>
      !!v && typeof v === "object" && typeof (v as any).name === "string",
  );
}

// schema.ts re-exports every table under BOTH its new "asset*" name and its
// legacy "image*" alias (e.g. `imageLibraries = assetLibraries`) so existing
// generated action code keeps working. Both exports point at the exact same
// Drizzle table object, so de-dupe by the underlying table before asserting —
// otherwise every column would be checked (and reported) twice under two
// different export names.
const seenTables = new Set<DrizzleTable>();

describe("assets db migrations cover every schema.ts column", () => {
  for (const [exportName, exported] of Object.entries(schema)) {
    if (!isDrizzleTable(exported)) continue;
    if (seenTables.has(exported)) continue;
    seenTables.add(exported);

    const columns = columnsOf(exported);
    if (!columns.length) continue;

    it(`every column on schema.${exportName} is mentioned in db.ts migrations`, () => {
      const missing = columns
        .map((c) => c.name)
        .filter(
          (columnName) => !new RegExp(`\\b${columnName}\\b`).test(dbTsSource),
        );
      expect(missing).toEqual([]);
    });
  }
});

/**
 * Guard for the name-based migration tracking convention (see the
 * `runMigrations` doc comment in packages/core/src/db/migrations.ts for the
 * full rationale — this is the fix for the analytics template's v75-v83
 * shared-DB version-collision incident where two branches independently
 * extended the same migration list under the same version numbers).
 *
 * Extracts every `{ version: N, ... }` migration entry from the raw db.ts
 * source (matching the exact object-literal shape this file uses: `version:`
 * immediately followed, a few lines later, by an optional `name: "..."`) and
 * asserts:
 *
 *   (a) every declared `name` is unique across the whole list, and
 *   (b) every entry whose version is > 34 (the max version already present in
 *       this template's migration list before the ensureAdditiveColumns /
 *       naming-convention wiring landed) has a `name`.
 *
 * We deliberately do NOT require every pre-existing entry (v1-v34) to have a
 * name — naming ALL of them would make every one of those migrations
 * re-apply by name on every existing database, which is only safe if every
 * single one of those older SQL statements is idempotent. A live-DB collision
 * audit against this template's Neon database (2026-07) found no holes and
 * verified the top versions' tables/columns/indexes all actually exist, so
 * there was no swallowed-migration bug to repair here — only the convention
 * comment and `ensureAdditiveColumns` safety net were added. Future
 * migrations above v34 must set a `name`.
 */
describe("assets db.ts migration entries follow the naming convention", () => {
  // Matches one migration entry's `version: N` followed later (before the
  // next `version:`) by an optional `name: "..."`. Entries in this file are
  // written as `{ version: N, [name: "...",] sql: ... }`, so scanning for
  // `version:` occurrences and capturing an optional immediately-following
  // `name:` is sufficient without a full parser.
  const entryRe = /version:\s*(\d+),\s*(?:name:\s*"([^"]+)",\s*)?/g;

  function extractEntries(source: string): Array<{
    version: number;
    name: string | null;
  }> {
    const entries: Array<{ version: number; name: string | null }> = [];
    for (const match of source.matchAll(entryRe)) {
      entries.push({
        version: Number(match[1]),
        name: match[2] ?? null,
      });
    }
    return entries;
  }

  const entries = extractEntries(dbTsSource);
  const PRE_EXISTING_MAX_VERSION = 34;

  it("finds migration entries to check (sanity guard against a regex drift)", () => {
    expect(entries.length).toBeGreaterThan(30);
  });

  it("every declared migration name is unique", () => {
    const names = entries.map((e) => e.name).filter((n): n is string => !!n);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toEqual([]);
  });

  it("every migration entry with version > 34 has a name", () => {
    const missingNames = entries
      .filter((e) => e.version > PRE_EXISTING_MAX_VERSION)
      .filter((e) => !e.name)
      .map((e) => e.version);
    expect(missingNames).toEqual([]);
  });
});

/**
 * Belt-and-braces guard for the same bug class: even with the regression
 * guard above, a future column could still ship without a migration if
 * someone forgets to update this file. `ensureAdditiveColumns` (from
 * @agent-native/core/db) is the framework-level safety net that patches any
 * gap at boot. This asserts db.ts actually wires it in — after
 * `runMigrations(...)` so hand-written migrations stay authoritative — not
 * just that the regex guard above passes.
 */
describe("assets db.ts wires ensureAdditiveColumns after runMigrations", () => {
  it("imports ensureAdditiveColumns from @agent-native/core/db", () => {
    expect(dbTsSource).toMatch(
      /import\s*\{[^}]*\bensureAdditiveColumns\b[^}]*\}\s*from\s*["']@agent-native\/core\/db["']/,
    );
  });

  it("calls ensureAdditiveColumns after runMigrations(...) completes", () => {
    const migrationsCallIdx = dbTsSource.indexOf("runMigrations(");
    const ensureCallIdx = dbTsSource.indexOf("ensureAdditiveColumns({");
    expect(migrationsCallIdx).toBeGreaterThan(-1);
    expect(ensureCallIdx).toBeGreaterThan(-1);
    expect(ensureCallIdx).toBeGreaterThan(migrationsCallIdx);

    // The runMigrations(...) plugin function must be awaited before
    // ensureAdditiveColumns runs, not just textually after it.
    expect(dbTsSource).toMatch(
      /await\s+runAssetsMigrations\([^)]*\)[\s\S]*?ensureAdditiveColumns\(\{/,
    );
  });

  it("preserves the legacy images_migrations bookkeeping table name", () => {
    expect(dbTsSource).toMatch(/\{\s*table:\s*"images_migrations"\s*\}/);
  });
});
