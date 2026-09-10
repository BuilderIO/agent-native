import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as schema from "../db/schema";

/**
 * Regression guard mirroring analytics/server/plugins/db.spec.ts, scoped to
 * the plan template. Walks every Drizzle table exported from schema.ts and
 * asserts every declared SQL column name appears somewhere in the migrations
 * source (db.ts) — either in the table's original `CREATE TABLE` or in a
 * later `ADD COLUMN` migration. It can't prove *ordering* (a column could
 * still be referenced only in a comment), but it catches the failure mode
 * where a schema column has zero mentions in the migration history — the
 * exact bug class `ensureAdditiveColumns` exists as a safety net for.
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
 * Columns confirmed (see db.ts comment on v37) to be genuinely missing from
 * db.ts's migration text at the time this guard was written. They ARE
 * mentioned in schema.ts and ARE covered by the now-named v37 migration
 * entry's SQL — this allowlist exists only because the regex below matches
 * on literal column-name text, and if a future rename or refactor
 * accidentally drops one of these from db.ts entirely, we still want the
 * loop to report it rather than silently pass. As of this writing every
 * plan schema column IS present in db.ts, so this list is empty; kept as a
 * documented escape hatch for the next drift finding rather than an
 * unconditional `toEqual([])`.
 */
const KNOWN_COVERAGE_DRIFT: Record<string, string[]> = {};

describe("plan db migrations cover every schema.ts column", () => {
  for (const [exportName, exported] of Object.entries(schema)) {
    if (!isDrizzleTable(exported)) continue;
    const columns = columnsOf(exported as DrizzleTable);
    if (!columns.length) continue;

    it(`every column on schema.${exportName} is mentioned in db.ts migrations`, () => {
      const allowlisted = new Set(KNOWN_COVERAGE_DRIFT[exportName] ?? []);
      const missing = columns
        .map((c) => c.name)
        .filter(
          (columnName) => !new RegExp(`\\b${columnName}\\b`).test(dbTsSource),
        )
        .filter((columnName) => !allowlisted.has(columnName));
      if (missing.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[db.spec] schema.${exportName} has columns not mentioned in db.ts migrations:`,
          missing,
        );
      }
      expect(missing).toEqual([]);
    });
  }
});

/**
 * Guard for the name-based migration tracking convention (see the
 * `runMigrations` doc comment in packages/core/src/db/migrations.ts for the
 * full rationale).
 *
 * Extracts every `{ version: N, ... }` migration entry from the raw db.ts
 * source (matching the exact object-literal shape this file uses: `version:`
 * immediately followed, a few lines later, by an optional `name: "..."`) and
 * asserts:
 *
 *   (a) every declared `name` is unique across the whole list, and
 *   (b) every entry whose version is > 37 (plan's current max version in
 *       code as of this writing) has a `name`.
 *
 * We deliberately do NOT require every legacy entry (v1-v37) to have a name —
 * naming ALL of them would make every one of those migrations re-apply by
 * name on every existing database, which is only safe if every single one of
 * those older SQL statements is idempotent. That has not been verified for
 * the full v1-v37 range, so only entries confirmed idempotent (v37, added
 * after the collision audit found it had never actually applied to the live
 * DB) carry a name.
 */
describe("plan db.ts migration entries follow the naming convention", () => {
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
  // Plan's migration list has gaps: versions 34/35 were never declared in
  // code (see the collision audit — the live DB recorded them from a
  // different historical migration path, but code has never declared those
  // version numbers). This is expected, pre-existing, and not something this
  // guard should flag.
  const MAX_VERSION_IN_CODE = 37;

  it("finds migration entries to check (sanity guard against a regex drift)", () => {
    // There are fewer entries than the max version number (v34/v35 are
    // deliberately absent from code) — this just guards against the regex
    // finding ~zero entries.
    expect(entries.length).toBeGreaterThan(30);
  });

  it("every declared migration name is unique", () => {
    const names = entries.map((e) => e.name).filter((n): n is string => !!n);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toEqual([]);
  });

  it(`every migration entry with version > ${MAX_VERSION_IN_CODE} has a name`, () => {
    const missingNames = entries
      .filter((e) => e.version > MAX_VERSION_IN_CODE)
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
describe("plan db.ts wires ensureAdditiveColumns after runMigrations", () => {
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
      /await\s+runPlanMigrations\([^)]*\)[\s\S]*?ensureAdditiveColumns\(\{/,
    );
  });

  it("keeps the plans_migrations bookkeeping table name", () => {
    expect(dbTsSource).toMatch(/table:\s*"plans_migrations"/);
  });

  it("keeps the guard:allow-unscoped comment at the top of the file", () => {
    expect(dbTsSource.trimStart().startsWith("// guard:allow-unscoped")).toBe(
      true,
    );
  });
});
