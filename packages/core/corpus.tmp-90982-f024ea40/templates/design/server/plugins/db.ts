import {
  ensureAdditiveColumns,
  getDbExec,
  runMigrations,
} from "@agent-native/core/db";

import * as schema from "../db/schema.js";

/**
 * Every Drizzle table exported from schema.ts. Filters out type-only and
 * helper exports the same way db.spec.ts's `isDrizzleTable` regression guard
 * does: a real table carries a Symbol-keyed drizzle metadata bag, plain
 * exports don't.
 */
function isDrizzleTable(value: unknown): value is object {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertySymbols(value).some((s) =>
      s.toString().includes("drizzle"),
    )
  );
}

const schemaTables = Object.values(schema).filter(isDrizzleTable);

// Convention: every new migration below MUST set a unique `name:` slug (see
// packages/core/src/db/migrations.ts for the full rationale). Version numbers
// alone are not a safe identity across parallel branches that each extend
// this list independently — see the analytics template's v75-v83 incident
// documented in templates/analytics/server/plugins/db.ts for the failure
// class this guards against.
const runDesignMigrations = runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS designs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    data TEXT NOT NULL,
    project_type TEXT NOT NULL DEFAULT 'prototype',
    design_system_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS design_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS design_systems (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    data TEXT NOT NULL,
    assets TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS design_system_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 5,
      sql: `CREATE TABLE IF NOT EXISTS design_files (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    content TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'html',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
    },
    {
      version: 6,
      sql: `CREATE TABLE IF NOT EXISTS design_versions (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    label TEXT,
    snapshot TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
    },
    // v7-v9: fix boolean columns on Postgres only. The adaptSqlForPostgres
    // rewriter turns INTEGER -> BIGINT, so migration v3 created is_default
    // as bigint. Drizzle's integer({ mode: "boolean" }) maps to pg boolean,
    // so inserts send a JS boolean that Postgres rejects. Convert to boolean.
    {
      version: 7,
      sql: {
        postgres: `ALTER TABLE design_systems ALTER COLUMN is_default DROP DEFAULT`,
      },
    },
    {
      version: 8,
      sql: {
        postgres: `ALTER TABLE design_systems ALTER COLUMN is_default TYPE boolean USING is_default::int::boolean`,
      },
    },
    {
      version: 9,
      sql: {
        postgres: `ALTER TABLE design_systems ALTER COLUMN is_default SET DEFAULT false`,
      },
    },
    {
      version: 10,
      sql: `ALTER TABLE design_systems ADD COLUMN IF NOT EXISTS custom_instructions TEXT NOT NULL DEFAULT ''`,
    },
    // v11: performance indexes. The ownable tables had no indexes, so every
    // accessFilter() scan (owner_email / org_id / visibility predicates plus
    // correlated EXISTS against the shares table) and every list ORDER BY
    // updated_at was a full table scan. Composite indexes match accessFilter's
    // ownership predicate + the list sort, and the shares indexes cover the
    // EXISTS subquery's resource_id / principal_type / principal_id lookup.
    // Additive only; portable across Postgres and SQLite (no DESC / partial /
    // PG-only syntax).
    {
      version: 11,
      sql: `CREATE INDEX IF NOT EXISTS designs_owner_org_updated_idx ON designs (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS design_systems_owner_org_updated_idx ON design_systems (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS design_shares_resource_principal_idx ON design_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS design_system_shares_resource_principal_idx ON design_system_shares (resource_id, principal_type, principal_id)`,
    },
    // v12: component_index — real-app component metadata (name, file path,
    // export name, parsed prop types, cva/tailwind-variants variants, Storybook
    // stories, runtime selectors). Ownable; access-checked via accessFilter /
    // assertAccess.
    {
      version: 12,
      sql: `CREATE TABLE IF NOT EXISTS component_index (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    source_ref TEXT,
    name TEXT NOT NULL,
    file_path TEXT,
    export_name TEXT,
    props TEXT,
    variants TEXT,
    stories TEXT,
    runtime_selectors TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v13: motion_timeline — CSS-first keyframe animation tracks scoped to one
    // design + source + screen/file. tracks JSON is the editing representation;
    // the compiled CSS block (managed <style data-agent-native-motion>) is the
    // runtime truth. compiled_hash guards drift between the two. Ownable.
    {
      version: 13,
      sql: `CREATE TABLE IF NOT EXISTS motion_timeline (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    source_ref TEXT,
    file_path TEXT,
    tracks TEXT NOT NULL DEFAULT '[]',
    duration_ms INTEGER NOT NULL DEFAULT 300,
    default_ease TEXT NOT NULL DEFAULT 'ease',
    compiled_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v14: design_state — design states (alternate x-data/DOM snapshots for
    // Default / Loading / Empty / Error), static data fixtures, and live
    // captures of running-app route + props + API data. Ownable.
    {
      version: 14,
      sql: `CREATE TABLE IF NOT EXISTS design_state (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    source_ref TEXT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'state',
    breakpoint TEXT NOT NULL DEFAULT 'auto',
    route TEXT,
    fixture_data TEXT,
    capture_data TEXT,
    preview_ref TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v15: design_review_snapshot — cached a11y audit results and visual diff
    // data keyed by design + optional base/compare design_versions pair.
    // status: 'pending' | 'ready' | 'error'. Ownable.
    {
      version: 15,
      sql: `CREATE TABLE IF NOT EXISTS design_review_snapshot (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    base_version_id TEXT,
    compare_version_id TEXT,
    source_ref TEXT,
    a11y_findings TEXT,
    visual_diff TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    // v16: localhost source connections and write-consent grants. The schema
    // existed before this migration in source, but fresh/existing DBs still
    // need the concrete tables and the bridge_token column used by localhost
    // write-back.
    {
      version: 16,
      sql: `CREATE TABLE IF NOT EXISTS design_localhost_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'localhost',
    dev_server_url TEXT NOT NULL,
    bridge_url TEXT,
    root_path TEXT,
    route_manifest TEXT NOT NULL DEFAULT '{}',
    capabilities TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'connected',
    last_seen_at TEXT,
    preview_token TEXT,
    bridge_token TEXT,
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
ALTER TABLE design_localhost_connections ADD COLUMN IF NOT EXISTS bridge_token TEXT;
ALTER TABLE design_localhost_connections ADD COLUMN IF NOT EXISTS preview_token TEXT;
CREATE TABLE IF NOT EXISTS design_localhost_write_grants (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    root_path TEXT NOT NULL,
    bridge_token TEXT NOT NULL,
    granted_until TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  );
CREATE INDEX IF NOT EXISTS design_localhost_connections_owner_idx ON design_localhost_connections (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS design_localhost_write_grants_lookup_idx ON design_localhost_write_grants (design_id, connection_id, owner_email)`,
    },
    // v17: older local databases may already have motion_timeline from the
    // pre-ownable prototype. Backfill the ownable columns additively so the
    // first "Add track" insert can persist through the current Drizzle schema.
    {
      version: 17,
      sql: `ALTER TABLE motion_timeline ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost';
ALTER TABLE motion_timeline ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE motion_timeline ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
CREATE INDEX IF NOT EXISTS motion_timeline_owner_org_updated_idx ON motion_timeline (owner_email, org_id, updated_at)`,
    },
    // v18: intentionally no-op. New org-scoped designs now default to
    // org-visible at creation time, but existing private org rows may have
    // been intentionally private. There is no durable marker that separates
    // old default-private rows from explicit private rows, so do not widen
    // historical access in a migration.
    {
      version: 18,
      sql: {},
    },
    // v19: design_fusion_edits — declared in schema.ts (queued AI edit intents
    // for fusion-backed full-app designs) but never had a migration create the
    // table, so any fresh/existing database without it 500s on first write.
    // Named per the convention above since this is a new entry.
    {
      version: 19,
      name: "design-fusion-edits-table",
      sql: `CREATE TABLE IF NOT EXISTS design_fusion_edits (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL,
    screen_file_id TEXT,
    instruction TEXT NOT NULL,
    target TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    batch_id TEXT,
    error TEXT,
    sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`,
    },
    {
      version: 20,
      name: "design-data-operation-revisions",
      sql: `ALTER TABLE designs ADD COLUMN IF NOT EXISTS data_operation_revisions TEXT NOT NULL DEFAULT '{}'`,
    },
    {
      version: 21,
      name: "design-file-content-operation-revisions",
      sql: `ALTER TABLE design_files ADD COLUMN IF NOT EXISTS content_operation_source TEXT;
ALTER TABLE design_files ADD COLUMN IF NOT EXISTS content_operation_revision INTEGER;
ALTER TABLE design_files ADD COLUMN IF NOT EXISTS content_operation_result_hash TEXT`,
    },
    {
      version: 22,
      name: "design-localhost-preview-token",
      sql: `ALTER TABLE design_localhost_connections ADD COLUMN IF NOT EXISTS preview_token TEXT`,
    },
    {
      version: 23,
      name: "design-templates",
      sql: `CREATE TABLE IF NOT EXISTS design_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    source_design_id TEXT,
    design_system_id TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    width INTEGER,
    height INTEGER,
    locked_layer_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  );
CREATE TABLE IF NOT EXISTS design_template_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE IF NOT EXISTS design_template_files (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    content TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'html',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
CREATE INDEX IF NOT EXISTS design_templates_owner_org_updated_idx ON design_templates (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS design_template_shares_resource_principal_idx ON design_template_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS design_template_files_template_idx ON design_template_files (template_id, updated_at)`,
    },
  ],
  { table: "design_migrations" },
);

/**
 * The migration list above is the authoritative source for tables, indexes,
 * and data transforms. `ensureAdditiveColumns` runs after it as a
 * belt-and-braces safety net for the same failure mode fixed in the
 * analytics template: a column added to schema.ts without a matching
 * hand-written ALTER migration, which silently 500s every query touching a
 * pre-existing production table. It only ever adds missing columns — never
 * drops, renames, or retypes anything — and any failure here is logged and
 * swallowed so it can never fail boot.
 */
/**
 * Best-effort unique index guarding against the add-localhost-screens
 * cross-request race: two concurrent calls placing the same localhost route
 * each see "no existing design_files row" from their own snapshot and both
 * insert a fresh row using the same deterministic filename for that route
 * (see actions/add-localhost-screens.ts). A unique index on
 * (design_id, filename) makes the losing insert fail instead of silently
 * creating an overlapping duplicate screen.
 *
 * This intentionally does NOT live in `runDesignMigrations` above:
 * `CREATE UNIQUE INDEX` fails outright against any database that already
 * contains a duplicate (design_id, filename) pair — e.g. from this exact race
 * having already fired before this fix shipped — and `runMigrations` has no
 * way to tolerate that failure class (only lock-timeout / duplicate-column /
 * permission errors are swallowed there). A failed migration entry blocks
 * every later entry in the list forever: it crashes the process outright in
 * local dev, and on serverless it silently stops applying anything past it on
 * every cold start. So this runs as its own best-effort step instead: created
 * when possible, safely skipped (with a warning) when legacy duplicates block
 * it. `add-localhost-screens.ts`'s insert path tolerates either outcome — it
 * catches a real unique-violation from this index and falls back to updating
 * the row that won the race, and is a no-op/no-crash path when the index
 * isn't present yet.
 */
async function ensureDesignFilesUniqueIndex(): Promise<void> {
  try {
    await getDbExec().execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS design_files_design_filename_unique_idx ON design_files (design_id, filename)`,
    );
  } catch (err) {
    console.warn(
      "[db] design_files_design_filename_unique_idx not created — likely " +
        "pre-existing duplicate (design_id, filename) rows from the " +
        "add-localhost-screens race predating this fix. New concurrent " +
        "inserts remain best-effort until the duplicates are cleaned up:",
      err instanceof Error ? err.message : err,
    );
  }
}

export default async (nitroApp: any): Promise<void> => {
  await runDesignMigrations(nitroApp);
  await ensureDesignFilesUniqueIndex();
  try {
    const summary = await ensureAdditiveColumns({
      db: getDbExec(),
      tables: schemaTables,
    });
    if (summary.errors.length > 0) {
      console.warn(
        "[db] ensureAdditiveColumns completed with errors:",
        summary.errors,
      );
    }
  } catch (err) {
    // Never fail boot over the safety net itself — the authoritative
    // migrations above already ran.
    console.warn(
      "[db] ensureAdditiveColumns failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
};
