import fs from "node:fs";
/**
 * Migration 40 (`plan-edition-window`) on a REAL upgrade path.
 *
 * A fresh dev database creates `plans` from schema.ts with the edition columns
 * already present, so migration 40's ALTERs are no-ops there and prove nothing.
 * This exercises the case that actually ships: an existing `plans` table that
 * predates the edition columns, with rows already in it.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planMigrations } from "./plugins/db.js";

let client: PGliteClient;
let dir: string;

/** The `plans` shape before migration 40 added the edition columns. */
const PRE_40_PLANS = `
  CREATE TABLE plans (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'plan', status TEXT NOT NULL DEFAULT 'draft',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    recap_idempotency_key TEXT,
    owner_email TEXT NOT NULL, org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  );
  INSERT INTO plans (id,title,brief,kind,created_at,updated_at,owner_email)
  VALUES ('plan-1','a','b','plan','2026-01-01','2026-01-01','u@x.com'),
         ('recap-1','c','d','recap','2026-01-01','2026-01-01','u@x.com');
`;

function migrationSql(name: string): string {
  const entry = planMigrations.find((migration) => migration.name === name);
  if (!entry) throw new Error(`migration ${name} not found`);
  const sql = entry.sql;
  return typeof sql === "string" ? sql : (sql.postgres as string);
}

const migration40Sql = () => migrationSql("plan-edition-window");
const migration41Sql = () => migrationSql("plan-edition-cohorts");
const migration42Sql = () => migrationSql("plan-edition-series");

async function applyStatements(sql: string): Promise<void> {
  for (const statement of sql
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await client.query(statement);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-mig40-"));
  client = await PGlite.create(dir);
  await client.exec(PRE_40_PLANS);
});

afterEach(async () => {
  await client?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe("migration 40 — plan-edition-window", () => {
  it("adds the edition columns and stories table to a pre-existing plans table", async () => {
    await applyStatements(migration40Sql());

    const columns = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'plans'`,
    )) as { rows: { column_name: string }[] };
    const names = columns.rows.map((row) => row.column_name);
    for (const column of [
      "edition_date_key",
      "edition_window_start",
      "edition_window_end",
      "edition_timezone",
      "edition_coverage_json",
    ])
      expect(names).toContain(column);

    const stories = await client.query(
      `SELECT count(*)::int AS n FROM plan_edition_stories`,
    );
    expect((stories.rows[0] as { n: number }).n).toBe(0);

    // Pre-existing rows survive untouched.
    const kept = await client.query(`SELECT count(*)::int AS n FROM plans`);
    expect((kept.rows[0] as { n: number }).n).toBe(2);
  });

  it("adds the cohort and issue-number columns on top of migration 40", async () => {
    await applyStatements(migration40Sql());
    await applyStatements(migration41Sql());

    const plansCols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'plans'`,
    )) as { rows: { column_name: string }[] };
    expect(plansCols.rows.map((r) => r.column_name)).toContain(
      "edition_issue_number",
    );

    const storyCols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'plan_edition_stories'`,
    )) as { rows: { column_name: string }[] };
    expect(storyCols.rows.map((r) => r.column_name)).toContain("cohorts_json");
  });

  it("replaces the day-only unique index with a series-aware one", async () => {
    await applyStatements(migration40Sql());
    await applyStatements(migration41Sql());
    await applyStatements(migration42Sql());

    const indexes = (await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'plans'`,
    )) as { rows: { indexname: string }[] };
    const names = indexes.rows.map((r) => r.indexname);
    expect(names).toContain("plans_edition_series_day_unique_idx");
    // The day-only index has to go, or a per-repo edition can never share a
    // day with the org-wide one.
    expect(names).not.toContain("plans_edition_day_unique_idx");

    const insert = (id: string, series: string | null) =>
      client.query(
        `INSERT INTO plans (id,title,brief,kind,created_at,updated_at,owner_email,edition_date_key,edition_series)
         VALUES ($1,'t','b','edition','2026-01-01','2026-01-01','u@x.com','2026-09-20',$2)`,
        [id, series],
      );

    // Two series, one day: both land.
    await insert("edition-daily", "daily");
    await insert("edition-internal", "internal-daily");

    // Same series, same day: still rejected.
    await expect(insert("edition-dupe", "internal-daily")).rejects.toThrow(
      /plans_edition_series_day_unique_idx/,
    );

    // A NULL series collides with 'daily', because the index coalesces it.
    await expect(insert("edition-null", null)).rejects.toThrow(
      /plans_edition_series_day_unique_idx/,
    );
  });

  it("is safe to re-run", async () => {
    await applyStatements(migration40Sql());
    await applyStatements(migration41Sql());
    await applyStatements(migration42Sql());
    await expect(applyStatements(migration40Sql())).resolves.toBeUndefined();
    await expect(applyStatements(migration41Sql())).resolves.toBeUndefined();
    await expect(applyStatements(migration42Sql())).resolves.toBeUndefined();
  });

  it("lets the partial unique index reject a second edition for one window", async () => {
    await applyStatements(migration40Sql());
    const insert = (id: string) =>
      client.query(
        `INSERT INTO plans (id,title,brief,kind,created_at,updated_at,owner_email,edition_date_key)
         VALUES ($1,'t','b','edition','2026-01-01','2026-01-01','u@x.com','2026-09-20')`,
        [id],
      );
    await insert("edition-1");
    await expect(insert("edition-2")).rejects.toThrow(
      /plans_edition_day_unique_idx/,
    );
  });

  it("still allows many recaps, which the partial index must not constrain", async () => {
    await applyStatements(migration40Sql());
    for (const id of ["recap-a", "recap-b", "recap-c"])
      await client.query(
        `INSERT INTO plans (id,title,brief,kind,created_at,updated_at,owner_email)
         VALUES ($1,'t','b','recap','2026-01-01','2026-01-01','u@x.com')`,
        [id],
      );
    const rows = await client.query(
      `SELECT count(*)::int AS n FROM plans WHERE kind = 'recap'`,
    );
    expect((rows.rows[0] as { n: number }).n).toBe(4);
  });
});
