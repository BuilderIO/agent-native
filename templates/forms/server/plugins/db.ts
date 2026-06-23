import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
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
