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
    expect(entries.length).toBeGreaterThan(60);
  });

  it("every declared migration name is unique", () => {
    const names = entries.map((e) => e.name).filter((n): n is string => !!n);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toEqual([]);
  });

  it("every migration entry with version > 60 has a name", () => {
    const missingNames = entries
      .filter((e) => e.version > 60)
      .filter((e) => !e.name)
      .map((e) => e.version);
    expect(missingNames).toEqual([]);
  });

  it("runs comment AI migrations after a deployed v92 ledger", () => {
    const byName = new Map(entries.map((entry) => [entry.name, entry.version]));
    expect(byName.get("content-comment-ai-requests-and-actor")).toBeGreaterThan(
      92,
    );
    expect(
      byName.get("content-comment-ai-active-thread-index"),
    ).toBeGreaterThan(92);
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

describe("content db.ts schedules post-boot maintenance after runMigrations", () => {
  const maintenanceSource = readFileSync(
    new URL("../lib/startup-maintenance.ts", import.meta.url),
    "utf8",
  );

  it("imports ensureAdditiveColumns from @agent-native/core/db", () => {
    expect(maintenanceSource).toMatch(
      /import\s*\{[^}]*\bensureAdditiveColumns\b[^}]*\}\s*from\s*["']@agent-native\/core\/db["']/,
    );
    expect(maintenanceSource).toContain("ensureAdditiveColumns({");
  });

  it("schedules maintenance only after both migration runners are awaited", () => {
    const contentMigrationsCallIdx = dbTsSource.indexOf(
      "runContentMigrations(",
    );
    const sourceMigrationsCallIdx = dbTsSource.indexOf(
      "runContentSourceMigrations(",
    );
    const scheduleCallIdx = dbTsSource.indexOf(
      "void scheduleStartupMaintenance();",
    );
    expect(contentMigrationsCallIdx).toBeGreaterThan(-1);
    expect(sourceMigrationsCallIdx).toBeGreaterThan(-1);
    expect(scheduleCallIdx).toBeGreaterThan(-1);
    expect(scheduleCallIdx).toBeGreaterThan(contentMigrationsCallIdx);
    expect(scheduleCallIdx).toBeGreaterThan(sourceMigrationsCallIdx);

    // Both migration plugin functions must be awaited before the scheduler
    // is called, not just textually after it — and the scheduler itself must
    // NOT be awaited (boot no longer pays for the net or the repairs).
    expect(dbTsSource).toMatch(
      /await\s+runContentMigrations\([^)]*\)[\s\S]*?await\s+runContentSourceMigrations\([^)]*\)[\s\S]*?void\s+scheduleStartupMaintenance\(\);/,
    );
  });

  it("boot no longer awaits the net or either repair", () => {
    expect(dbTsSource).not.toMatch(/await\s+ensureAdditiveColumns/);
    expect(dbTsSource).not.toMatch(/await\s+repairUnseededBlocksFields/);
    expect(dbTsSource).not.toMatch(
      /await\s+repairFilesSystemPropertyDefinitions/,
    );
    expect(dbTsSource).not.toContain("scheduleBlocksRepairRetry");
  });

  it("the lazy module runs both repairs after the net and logs failures loudly", () => {
    const netIdx = maintenanceSource.indexOf("additive-columns");
    const blocksIdx = maintenanceSource.indexOf("blocks-repair");
    const filesIdx = maintenanceSource.indexOf(
      "files-system-properties-repair",
    );
    expect(netIdx).toBeGreaterThan(-1);
    expect(blocksIdx).toBeGreaterThan(netIdx);
    expect(filesIdx).toBeGreaterThan(blocksIdx);

    expect(maintenanceSource).toContain("repairUnseededBlocksFields");
    expect(maintenanceSource).toContain("repairFilesSystemPropertyDefinitions");
    expect(maintenanceSource).toMatch(
      /console\.error\(\s*`\[db\] startup maintenance "\$\{label\}"/,
    );
    expect(maintenanceSource).toMatch(/\bscheduleRetry\b/);
  });

  it("treats additive-column summary errors as a retryable failed step", () => {
    expect(maintenanceSource).toMatch(
      /summary\.errors\.length > 0[\s\S]{0,400}throw new Error\(/,
    );
  });

  it("awaits each retry chain before the next step and keeps the trigger ref'd", () => {
    // A fire-and-forget retry would let the next step race the safety net
    // the retry is still finishing, so the chain must be awaited.
    expect(maintenanceSource).toMatch(/await\s+scheduleRetry\(/);
    const triggerIdx = maintenanceSource.indexOf(
      "export function scheduleStartupMaintenance",
    );
    expect(triggerIdx).toBeGreaterThan(-1);
    expect(maintenanceSource.slice(triggerIdx)).not.toMatch(/\.unref\(/);
    expect(maintenanceSource.match(/\.unref\(/g)?.length).toBe(1);
  });

  it("does not remove the body-hydration queue index migration (v60)", () => {
    expect(dbTsSource).toMatch(
      /CREATE INDEX IF NOT EXISTS content_database_items_body_hydration_idx ON content_database_items \(database_id, body_hydration_status\)/,
    );
  });

  it("backfills legacy deleted database trees into explicit document Trash roots", () => {
    expect(dbTsSource).toContain('name: "backfill-database-trash-roots"');
    expect(dbTsSource).toMatch(
      /WITH RECURSIVE legacy_database_trash[\s\S]*?child\.parent_id = legacy_database_trash\.document_id[\s\S]*?trash_root_id = \([\s\S]*?legacy_database_trash\.root_id/,
    );
    expect(dbTsSource).toMatch(
      /child_database\.document_id = child\.id[\s\S]*?child_database\.deleted_at IS NOT NULL/,
    );
  });
});
