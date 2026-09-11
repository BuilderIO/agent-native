import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as schema from "../db/schema";

/**
 * Regression guard mirroring templates/analytics/server/plugins/db.spec.ts.
 *
 * This walks every Drizzle table exported from schema.ts and asserts every
 * declared SQL column name appears somewhere in the migrations source
 * (db.ts) — either in the table's original `CREATE TABLE` or in a later
 * `ADD COLUMN` migration. It can't prove *ordering* (a column could still be
 * referenced only in a comment), but it catches the exact failure mode of a
 * schema column with zero mentions in the migration history — the same class
 * of bug that caused `session_recordings.network_error_count` to 42703 in
 * analytics.
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

describe("brain db migrations cover every schema.ts column", () => {
  for (const [exportName, exported] of Object.entries(schema)) {
    if (!isDrizzleTable(exported)) continue;
    const columns = columnsOf(exported as DrizzleTable);
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
 * full rationale — the fix for the shared-DB version-collision incident where
 * two branches independently extend the same migration list under the same
 * version numbers).
 *
 * A live read-only audit against the shared Neon database (2026-07-02) found
 * exactly this collision here: a parallel branch recorded v21/v22 in
 * `brain_migrations` for its own `brain_ask_history` tables before this
 * template's v20 (11 performance indexes) ever ran, so the legacy
 * `version > MAX(recorded version)` gate treated v20 as already applied even
 * though none of its indexes existed. v20 was repaired with a `name:` slug
 * (`"brain-ownable-perf-indexes"`) so it re-applies by name on any database
 * regardless of recorded MAX(version). See the comment on v20 in db.ts.
 *
 * Extracts every `{ version: N, ... }` migration entry from the raw db.ts
 * source (matching the exact object-literal shape this file uses: `version:`
 * immediately followed, a few lines later, by an optional `name: "..."`) and
 * asserts:
 *
 *   (a) every declared `name` is unique across the whole list, and
 *   (b) every entry whose version is > 20 (brain's own pre-existing max
 *       version before the naming convention was introduced) has a `name`.
 *
 * We deliberately do NOT require every legacy entry (v1-v20, aside from the
 * repaired v20) to have a name — naming ALL of them would make every one of
 * those migrations re-apply by name on every existing database, which is
 * only safe if every single one of those older SQL statements is idempotent.
 * That has not been verified here, so only entries from v21 onward (going
 * forward) are required to be named, plus v20 itself (confirmed idempotent
 * and confirmed swallowed by the live audit above).
 */
describe("brain db.ts migration entries follow the naming convention", () => {
  // Matches one migration entry's `version: N` followed later (before the
  // next `version:`) by an optional `name: "..."`. Entries in this file are
  // written as `{ version: N, [comments/][name: "...",] sql: ... }`, so
  // scanning for `version:` occurrences and capturing the next `name:` before
  // the next `version:` is sufficient without a full parser.
  const entryRe =
    /version:\s*(\d+),[\s\S]*?(?=version:\s*\d+,|\]\s*,\s*\{\s*table)/g;
  const nameRe = /name:\s*"([^"]+)"/;

  function extractEntries(source: string): Array<{
    version: number;
    name: string | null;
  }> {
    const entries: Array<{ version: number; name: string | null }> = [];
    for (const match of source.matchAll(entryRe)) {
      const nameMatch = nameRe.exec(match[0]);
      entries.push({
        version: Number(match[1]),
        name: nameMatch ? nameMatch[1] : null,
      });
    }
    return entries;
  }

  const entries = extractEntries(dbTsSource);

  it("finds migration entries to check (sanity guard against a regex drift)", () => {
    // Brain currently has 20 migration entries (v1-v20, one of which — v20 —
    // is a single entry with 11 statements joined together, not 11 separate
    // entries). Guard against the regex finding ~zero entries.
    expect(entries.length).toBeGreaterThanOrEqual(20);
  });

  it("every declared migration name is unique", () => {
    const names = entries.map((e) => e.name).filter((n): n is string => !!n);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toEqual([]);
  });

  it("every migration entry with version >= 20 has a name", () => {
    const missingNames = entries
      .filter((e) => e.version >= 20)
      .filter((e) => !e.name)
      .map((e) => e.version);
    expect(missingNames).toEqual([]);
  });

  it("the repaired v20 performance-index migration keeps its name", () => {
    const v20 = entries.find((e) => e.version === 20);
    expect(v20?.name).toBe("brain-ownable-perf-indexes");
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
describe("brain db.ts wires ensureAdditiveColumns after runMigrations", () => {
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
      /await\s+runBrainMigrations\([^)]*\)[\s\S]*?ensureAdditiveColumns\(\{/,
    );
  });
});
