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
// this list independently against the shared `forms_migrations` table.
const runFormsMigrations = runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    slug TEXT NOT NULL UNIQUE,
    fields TEXT NOT NULL,
    settings TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES forms(id),
    data TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    ip TEXT
  )`,
    },
    {
      version: 3,
      sql: {
        postgres: `ALTER TABLE forms ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
CREATE TABLE IF NOT EXISTS form_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now())
)`,
        sqlite: `ALTER TABLE forms ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
      },
    },
    {
      version: 4,
      sql: { sqlite: `ALTER TABLE forms ADD COLUMN IF NOT EXISTS org_id TEXT` },
    },
    {
      version: 5,
      sql: {
        sqlite: `ALTER TABLE forms ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
      },
    },
    {
      version: 6,
      sql: {
        sqlite: `CREATE TABLE IF NOT EXISTS form_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
      },
    },
    {
      version: 7,
      sql: {
        postgres: `ALTER TABLE responses ADD COLUMN IF NOT EXISTS submitter_email TEXT`,
        sqlite: `ALTER TABLE responses ADD COLUMN IF NOT EXISTS submitter_email TEXT`,
      },
    },
    {
      version: 8,
      sql: {
        postgres: `ALTER TABLE forms ADD COLUMN IF NOT EXISTS deleted_at TEXT`,
        sqlite: `ALTER TABLE forms ADD COLUMN IF NOT EXISTS deleted_at TEXT`,
      },
    },
    {
      version: 9,
      sql: {
        postgres: `ALTER TABLE forms ALTER COLUMN visibility SET DEFAULT 'private'`,
        sqlite: `SELECT 1`,
      },
    },
    {
      // Performance indexes. Plain CREATE INDEX IF NOT EXISTS works on both
      // Postgres and SQLite, so a single dialect-agnostic string suffices.
      // - forms list query filters on owner_email/org_id (via accessFilter)
      //   and orders by updated_at.
      // - responses are filtered by form_id on every form open and listed
      //   ordered by submitted_at; the composite covers both.
      // - form_shares lookups join on resource_id + principal_type/id.
      version: 10,
      sql: `CREATE INDEX IF NOT EXISTS forms_owner_org_updated_idx ON forms (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS responses_form_id_idx ON responses (form_id, submitted_at);
CREATE INDEX IF NOT EXISTS form_shares_resource_idx ON form_shares (resource_id, principal_type, principal_id)`,
    },
    {
      // Page URL the respondent was on, forwarded by trusted embeds (e.g. the
      // framework FeedbackButton) as a hidden pass-through field so owners can
      // see which screen feedback came from in the responses table.
      version: 11,
      sql: {
        postgres: `ALTER TABLE responses ADD COLUMN IF NOT EXISTS page_url TEXT`,
        sqlite: `ALTER TABLE responses ADD COLUMN IF NOT EXISTS page_url TEXT`,
      },
    },
    {
      // Client surface (web/electron/tauri) the respondent submitted from,
      // forwarded by trusted embeds as a hidden pass-through field so owners can
      // see whether feedback came from a desktop app or the browser.
      version: 12,
      sql: {
        postgres: `ALTER TABLE responses ADD COLUMN IF NOT EXISTS client_surface TEXT`,
        sqlite: `ALTER TABLE responses ADD COLUMN IF NOT EXISTS client_surface TEXT`,
      },
    },
  ],
  { table: "forms_migrations" },
);

/**
 * The migration list above is the authoritative source for tables, indexes,
 * and data transforms. `ensureAdditiveColumns` runs after it as a
 * belt-and-braces safety net for the case where a column gets added to
 * schema.ts without a matching hand-written ALTER migration, which would
 * silently 500 every query touching a pre-existing production table. It only
 * ever adds missing columns — never drops, renames, or retypes anything — and
 * any failure here is logged and swallowed so it can never fail boot.
 */
export default async (nitroApp: any): Promise<void> => {
  await runFormsMigrations(nitroApp);
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
