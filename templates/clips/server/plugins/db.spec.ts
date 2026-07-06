import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as schema from "../db/schema";

/**
 * Regression guard, mirroring templates/analytics/server/plugins/db.spec.ts.
 *
 * This walks every Drizzle table exported from schema.ts and asserts every
 * declared SQL column name appears somewhere in the migrations source
 * (db.ts) — either in the table's original `CREATE TABLE` or in a later
 * `ADD COLUMN` migration. It can't prove *ordering* (a column could still be
 * referenced only in a comment), but it catches the exact failure mode this
 * guard exists for: a schema column with zero mentions in the migration
 * history, which silently 500s every query touching a pre-existing
 * production table once the column is used.
 *
 * A small number of columns are intentionally NOT asserted here (see
 * `KNOWN_COVERAGE_DRIFT` below) — pre-existing drift unrelated to this
 * change, where `ensureAdditiveColumns` (wired in db.ts below) self-heals the
 * gap at boot instead of a hand-written migration.
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

/**
 * Pre-existing schema.ts columns with zero mentions in db.ts migrations,
 * found while adding this guard. None of these are introduced by this
 * change — they predate it. `ensureAdditiveColumns` patches any of these
 * that are actually missing from a live table at boot, so leaving them
 * unasserted here does not reintroduce the swallowed-migration failure mode;
 * it just means this specific regex guard doesn't cover them. Reported to
 * the task owner for follow-up rather than silently asserted away.
 */
const KNOWN_COVERAGE_DRIFT = new Set<string>([]);

describe("clips db migrations cover every schema.ts column", () => {
  for (const [exportName, exported] of Object.entries(schema)) {
    if (!isDrizzleTable(exported)) continue;
    const columns = columnsOf(exported as DrizzleTable);
    if (!columns.length) continue;

    it(`every column on schema.${exportName} is mentioned in db.ts migrations`, () => {
      const missing = columns
        .map((c) => c.name)
        .filter(
          (columnName) => !new RegExp(`\\b${columnName}\\b`).test(dbTsSource),
        )
        .filter((columnName) => !KNOWN_COVERAGE_DRIFT.has(columnName));
      expect(missing).toEqual([]);
    });
  }
});

/**
 * Guard for the name-based migration tracking convention (see the
 * `runMigrations` doc comment in packages/core/src/db/migrations.ts for the
 * full rationale — this is the fix for the shared-DB version-collision
 * failure class, confirmed live on this template's own database: v41 was
 * recorded as applied in `clips_migrations` yet none of its 8 indexes
 * existed on the live table).
 *
 * Extracts every `{ version: N, ... }` migration entry from the raw db.ts
 * source (matching the exact object-literal shape this file uses: `version:`
 * immediately followed, a few lines later, by an optional `name: "..."`) and
 * asserts:
 *
 *   (a) every declared `name` is unique across the whole list, and
 *   (b) every entry whose version is > 44 (the template's own max
 *       pre-existing version, i.e. every migration going forward) has a
 *       `name`.
 */
describe("clips db.ts migration entries follow the naming convention", () => {
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

  it("finds migration entries to check (sanity guard against a regex drift)", () => {
    expect(entries.length).toBeGreaterThan(35);
  });

  it("every declared migration name is unique", () => {
    const names = entries.map((e) => e.name).filter((n): n is string => !!n);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toEqual([]);
  });

  it("every migration entry with version > 44 has a name", () => {
    const missingNames = entries
      .filter((e) => e.version > 44)
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
 * gap at boot. This asserts db.ts actually wires it in — after the
 * migrations plugin function completes so hand-written migrations stay
 * authoritative — not just that the regex guard above passes.
 */
describe("clips db.ts wires ensureAdditiveColumns after migrations", () => {
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

    // The migrations plugin function must be awaited before
    // ensureAdditiveColumns runs, not just textually after it.
    expect(dbTsSource).toMatch(
      /await\s+migrations\([^)]*\)[\s\S]*?ensureAdditiveColumns\(\{/,
    );
  });

  it("does not remove the v41 hot-path index fix", () => {
    expect(dbTsSource).toMatch(
      /name:\s*"recordings-comments-shares-hot-path-indexes"/,
    );
  });
});
