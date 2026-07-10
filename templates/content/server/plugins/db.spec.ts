import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as schema from "../db/schema";

/**
 * Regression guard mirroring templates/analytics/server/plugins/db.spec.ts:
 * every Drizzle table exported from schema.ts should have every declared SQL
 * column mentioned somewhere in the migration source (db.ts) — either in the
 * table's original `CREATE TABLE` or in a later `ADD COLUMN` migration. It
 * can't prove *ordering* (a column could still be referenced only in a
 * comment), but it catches the exact failure mode this rollout guards
 * against: a schema column with zero mentions in the migration history.
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

describe("content db migrations cover every schema.ts column", () => {
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
 * full rationale, and templates/analytics/server/plugins/db.ts for the
 * version-collision incident this convention was introduced to prevent).
 *
 * Extracts every `{ version: N, ... }` migration entry from the raw db.ts
 * source (matching the exact object-literal shape this file uses: `version:`
 * immediately followed, a few lines later, by an optional `name: "..."`) and
 * asserts:
 *
 *   (a) every declared `name` is unique across the whole list, and
 *   (b) every entry whose version is greater than content's current max
 *       version as of this change (60, pinned as a literal) has a `name`.
 *
 * We deliberately do NOT require any existing entry (v1-v60, or the separate
 * content_source_migrations v1-v5) to have a name — only migrations added
 * after this rollout are required to carry one. The audit performed alongside
 * this change found no version collisions and no coverage drift in the
 * current list, so there is nothing to retroactively name.
 */
describe("content db.ts migration entries follow the naming convention", () => {
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
    // content_migrations has 60 entries plus content_source_migrations has 5
    // more; this just guards against the regex finding ~zero entries.
    expect(entries.length).toBeGreaterThan(60);
  });

  it("every declared migration name is unique", () => {
    const names = entries.map((e) => e.name).filter((n): n is string => !!n);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toEqual([]);
  });

  it("every migration entry with version > 60 has a name", () => {
    // Both runContentMigrations (max 60) and runContentSourceMigrations (max
    // 5) share this same source file and regex scan, so a version > 60 can
    // only be a NEW entry added to either list after this change — the
    // content_source_migrations list's own v1-v5 are all <= 60 and stay
    // unaffected.
    const missingNames = entries
      .filter((e) => e.version > 60)
      .filter((e) => !e.name)
      .map((e) => e.version);
    expect(missingNames).toEqual([]);
  });

  it("keeps Builder source refresh hot-path indexes in migrations", () => {
    expect(dbTsSource).toContain(
      "content_database_source_rows_source_item_idx",
    );
    expect(dbTsSource).toContain(
      "content_database_body_hydration_queue_source_document_idx",
    );
    expect(dbTsSource).toContain(
      "content_database_body_hydration_queue_item_idx",
    );
    expect(dbTsSource).toContain(
      "content_database_items_database_position_idx",
    );
    expect(dbTsSource).toContain(
      "content_database_source_fields_source_key_idx",
    );
  });
});

/**
 * Belt-and-braces guard for the same bug class: even with the regression
 * guard above, a future column could still ship without a migration if
 * someone forgets to update this file. `ensureAdditiveColumns` (from
 * @agent-native/core/db) is the framework-level safety net that patches any
 * gap at boot. This asserts db.ts actually wires it in — after both
 * `runContentMigrations(...)` and `runContentSourceMigrations(...)` so
 * hand-written migrations stay authoritative — not just that the regex guard
 * above passes.
 */
describe("content db.ts wires ensureAdditiveColumns after runMigrations", () => {
  it("imports ensureAdditiveColumns from @agent-native/core/db", () => {
    expect(dbTsSource).toMatch(
      /import\s*\{[^}]*\bensureAdditiveColumns\b[^}]*\}\s*from\s*["']@agent-native\/core\/db["']/,
    );
  });

  it("calls ensureAdditiveColumns after both migration runners complete", () => {
    const contentMigrationsCallIdx = dbTsSource.indexOf(
      "runContentMigrations(",
    );
    const sourceMigrationsCallIdx = dbTsSource.indexOf(
      "runContentSourceMigrations(",
    );
    const ensureCallIdx = dbTsSource.indexOf("ensureAdditiveColumns({");
    expect(contentMigrationsCallIdx).toBeGreaterThan(-1);
    expect(sourceMigrationsCallIdx).toBeGreaterThan(-1);
    expect(ensureCallIdx).toBeGreaterThan(-1);
    expect(ensureCallIdx).toBeGreaterThan(contentMigrationsCallIdx);
    expect(ensureCallIdx).toBeGreaterThan(sourceMigrationsCallIdx);

    // Both migration plugin functions must be awaited before
    // ensureAdditiveColumns runs, not just textually after it.
    expect(dbTsSource).toMatch(
      /await\s+runContentMigrations\([^)]*\)[\s\S]*?await\s+runContentSourceMigrations\([^)]*\)[\s\S]*?ensureAdditiveColumns\(\{/,
    );
  });

  it("does not remove the body-hydration queue index migration (v60)", () => {
    expect(dbTsSource).toMatch(
      /CREATE INDEX IF NOT EXISTS content_database_items_body_hydration_idx ON content_database_items \(database_id, body_hydration_status\)/,
    );
  });
});
