import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as schema from "../db/schema";

/**
 * Regression guard for the bug fixed here: `network_error_count` was added to
 * `sessionRecordings` in server/db/schema.ts (commit b68e4f72aa) without a
 * matching `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration in db.ts.
 * `CREATE TABLE IF NOT EXISTS` is a no-op on a table that already exists, so
 * every pre-existing production `session_recordings` row was missing the
 * column — every read (`db.select()` names all schema columns explicitly)
 * 42703'd, turning into a 500 on every `list-session-recordings` call.
 *
 * This walks every Drizzle table exported from schema.ts and asserts every
 * declared SQL column name appears somewhere in the migrations source
 * (db.ts) — either in the table's original `CREATE TABLE` or in a later
 * `ADD COLUMN` migration. It can't prove *ordering* (a column could still be
 * referenced only in a comment), but it catches the exact failure mode here:
 * a schema column with zero mentions in the migration history.
 */

const dbTsSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const analyticsRollupsTsSource = readFileSync(
  new URL("../lib/first-party-analytics-rollups.ts", import.meta.url),
  "utf8",
);

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

describe("analytics db migrations cover every schema.ts column", () => {
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

describe("analytics backfill has scoped cursor indexes", () => {
  it("indexes both organization and personal received_at cursors", () => {
    expect(dbTsSource).toContain(
      "analytics_events_org_received_id_idx ON analytics_events (org_id, received_at, id)",
    );
    expect(dbTsSource).toContain(
      "analytics_events_owner_received_id_idx ON analytics_events (owner_email, received_at, id)",
    );
  });
});

/**
 * Guard for the name-based migration tracking convention (see the
 * `runMigrations` doc comment in packages/core/src/db/migrations.ts for the
 * full rationale — this is the fix for the v75-v83 shared-DB version-collision
 * incident where two branches independently extended this same migration
 * list under the same version numbers).
 *
 * Extracts every `{ version: N, ... }` migration entry from the raw db.ts
 * source (matching the exact object-literal shape this file uses: `version:`
 * immediately followed, a few lines later, by an optional `name: "..."`) and
 * asserts:
 *
 *   (a) every declared `name` is unique across the whole list, and
 *   (b) every entry whose version is > 74 (the first collision-affected
 *       version) has a `name`.
 *
 * We deliberately do NOT require every legacy entry (v1-v74) to have a name —
 * naming ALL of them would make every one of those migrations re-apply by
 * name on every existing database, which is only safe if every single one of
 * those older SQL statements is idempotent. That has not been verified here,
 * so only the v75+ range (confirmed idempotent: IF NOT EXISTS / ADD COLUMN IF
 * NOT EXISTS everywhere) is named.
 */
describe("analytics db.ts migration entries follow the naming convention", () => {
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
    // There are fewer entries than the max version number (some version
    // numbers were deliberately reserved/skipped — see the v37/v38 comment in
    // db.ts) — this just guards against the regex finding ~zero entries.
    expect(entries.length).toBeGreaterThan(65);
  });

  it("every declared migration name is unique", () => {
    const names = entries.map((e) => e.name).filter((n): n is string => !!n);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toEqual([]);
  });

  it("every migration entry with version > 74 has a name", () => {
    const missingNames = entries
      .filter((e) => e.version > 74)
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
describe("analytics db.ts wires ensureAdditiveColumns after runMigrations", () => {
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
      /await\s+runAnalyticsMigrations\([^)]*\)[\s\S]*?ensureAdditiveColumns\(\{/,
    );
  });

  it("does not remove the v79 network_error_count backfill migration", () => {
    expect(dbTsSource).toMatch(
      /ALTER TABLE session_recordings ADD COLUMN IF NOT EXISTS network_error_count/,
    );
  });

  it("indexes the alert-rule sweep query by enabled status and evaluation time", () => {
    expect(dbTsSource).toMatch(
      /CREATE INDEX IF NOT EXISTS analytics_alert_rules_enabled_eval_idx ON analytics_alert_rules \(enabled, last_status, last_evaluated_at, created_at\)/,
    );
  });

  it("records the historical rollup migration without scanning history at boot", () => {
    expect(dbTsSource).toMatch(/name: "analytics-rollups-historical-backfill"/);
    expect(dbTsSource).toMatch(
      /version: 132,[\s\S]*?name: "analytics-rollups-historical-backfill",[\s\S]*?sql: \{\},[\s\S]*?\n\s*\},/,
    );
    expect(dbTsSource).not.toMatch(
      /run:\s*runHistoricalAnalyticsRollupBackfill/,
    );
    expect(dbTsSource).not.toContain("FROM analytics_events");
    expect(dbTsSource).not.toContain(
      "LOCK TABLE analytics_event_daily_rollups",
    );
    expect(dbTsSource).not.toContain("LOCK TABLE analytics_events");
    expect(dbTsSource).toContain("new migration identity");
    expect(dbTsSource).toContain("out-of-band job");
  });

  it("records the repair marker without making the backfill a boot dependency", () => {
    const repairStart = dbTsSource.indexOf("version: 134,");
    const repairEnd = dbTsSource.indexOf("version: 135,", repairStart);
    const repairEntry = dbTsSource.slice(repairStart, repairEnd);

    expect(repairStart).toBeGreaterThan(-1);
    expect(repairEnd).toBeGreaterThan(repairStart);
    expect(repairEntry).toContain(
      'name: "analytics-rollups-historical-backfill-repair"',
    );
    expect(repairEntry).toContain("sql: {},");
    expect(repairEntry).not.toContain("run:");
    expect(dbTsSource).not.toContain("deferMigration");
    expect(dbTsSource).not.toContain(
      "isHistoricalAnalyticsRollupBackfillComplete",
    );
  });

  it("stores BigQuery backfill progress in a durable scoped job table", () => {
    const jobStart = dbTsSource.indexOf("version: 139,");
    const jobEnd = dbTsSource.indexOf("\n    },", jobStart);
    const jobEntry = dbTsSource.slice(jobStart, jobEnd);

    expect(jobStart).toBeGreaterThan(-1);
    expect(jobEnd).toBeGreaterThan(jobStart);
    expect(jobEntry).toContain('name: "analytics-bigquery-backfill-jobs"');
    expect(jobEntry).toContain("analytics_bigquery_backfill_jobs");
    expect(jobEntry).toContain("lease_token");
    expect(jobEntry).toContain("next_run_at");
    expect(jobEntry).toContain("analytics_bigquery_backfill_jobs_due_idx");
    expect(jobEntry).not.toContain("FROM analytics_events");
  });

  it("does not serialize foreground rollup ingest behind historical backfill", () => {
    expect(analyticsRollupsTsSource).not.toContain("pg_advisory_xact_lock");
    expect(analyticsRollupsTsSource).not.toContain(
      "FIRST_PARTY_ANALYTICS_ROLLUP_BACKFILL_LOCK_KEY",
    );
  });

  it("does not scan every dashboard during serverless startup", () => {
    expect(dbTsSource).not.toContain(
      "repairUnboundedFirstPartyPanelsAcrossDashboards",
    );
  });

  it("does not run dashboard repair during database startup", () => {
    const pluginSource = dbTsSource.slice(
      dbTsSource.lastIndexOf("export default async"),
    );
    expect(pluginSource).not.toContain(
      "repairPersistedFirstPartyDashboardQueries",
    );
  });

  it("skips Analytics migrations in non-rollup durable background functions", () => {
    const pluginSource = dbTsSource.slice(
      dbTsSource.lastIndexOf("export default async"),
    );
    const backgroundGuardIdx = pluginSource.indexOf(
      "if (isInBackgroundFunctionRuntime() && !isScheduledRollupRuntime) {",
    );
    const migrationsCallIdx = pluginSource.indexOf(
      "await runAnalyticsMigrations(",
    );
    expect(backgroundGuardIdx).toBeGreaterThan(-1);
    expect(migrationsCallIdx).toBeGreaterThan(backgroundGuardIdx);
    expect(pluginSource.slice(backgroundGuardIdx, migrationsCallIdx)).toMatch(
      /return;/,
    );
    expect(pluginSource).toContain(
      "__AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__",
    );
  });

  it("returns before runAnalyticsMigrations in unscheduled production serverless runtime", () => {
    const pluginSource = dbTsSource.slice(
      dbTsSource.lastIndexOf("export default async"),
    );
    const serverlessGuardIdx = pluginSource.indexOf(
      "if (isNetlifyServerlessRuntime && !isScheduledRollupRuntime) {",
    );
    const migrationsCallIdx = pluginSource.indexOf(
      "await runAnalyticsMigrations(",
    );
    expect(serverlessGuardIdx).toBeGreaterThan(-1);
    expect(migrationsCallIdx).toBeGreaterThan(serverlessGuardIdx);
    expect(pluginSource.slice(serverlessGuardIdx, migrationsCallIdx)).toMatch(
      /return;/,
    );
    expect(pluginSource).toContain(
      "Skipping Analytics migrations in production serverless runtime",
    );
    expect(pluginSource).not.toContain("ANALYTICS_SKIP_BOOT_MIGRATIONS");
  });
});
