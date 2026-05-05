/**
 * Drizzle schema for the framework extensions system.
 *
 * Extensions are mini Alpine.js apps that run inside sandboxed iframes. They
 * can call external APIs via a server-side proxy that resolves `${keys.NAME}`
 * secret references. Extensions use the standard sharing model (private by
 * default, shareable with org/others).
 *
 * The tables are auto-created at server boot via `ensureTable()` in store.ts,
 * following the same pattern as `app_secrets`.
 *
 * NOTE: physical SQL table/column names stay as `extensions`, `tool_data`,
 * `tool_shares`, `tool_consents`, `tool_id`, etc. — additive-only schema
 * policy means we never rename DB-level identifiers. The JS/TS surface is
 * renamed to `extensions`/`extension*`; the DB-side names stay so existing
 * deployed rows remain readable.
 */

import { table, text, now } from "../db/schema.js";
import { ownableColumns, createSharesTable } from "../sharing/schema.js";

export const extensions = table("extensions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  content: text("content").notNull().default(""),
  icon: text("icon"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const extensionShares = createSharesTable("tool_shares");

export const EXTENSIONS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`;

export const EXTENSIONS_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now(),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`;

export const EXTENSION_SHARES_CREATE_SQL = `CREATE TABLE IF NOT EXISTS tool_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export const EXTENSION_SHARES_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS tool_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
)`;

export const extensionData = table("tool_data", {
  id: text("id").primaryKey(),
  extensionId: text("tool_id").notNull(),
  collection: text("collection").notNull(),
  itemId: text("item_id"),
  data: text("data").notNull(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  scope: text("scope").notNull().default("user"),
  orgId: text("org_id"),
  scopeKey: text("scope_key").notNull().default("local@localhost"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const EXTENSION_DATA_CREATE_SQL = `CREATE TABLE IF NOT EXISTS tool_data (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  item_id TEXT,
  data TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  scope TEXT NOT NULL DEFAULT 'user',
  org_id TEXT,
  scope_key TEXT NOT NULL DEFAULT 'local@localhost',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export const EXTENSION_DATA_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS tool_data (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  item_id TEXT,
  data TEXT NOT NULL,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  scope TEXT NOT NULL DEFAULT 'user',
  org_id TEXT,
  scope_key TEXT NOT NULL DEFAULT 'local@localhost',
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
)`;

export const EXTENSION_DATA_ITEM_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS tool_data_scoped_item_idx
  ON tool_data (tool_id, collection, scope_key, item_id)`;

export const EXTENSION_DATA_ITEM_INDEX_SQL_PG = `CREATE UNIQUE INDEX IF NOT EXISTS tool_data_scoped_item_idx
  ON tool_data (tool_id, collection, scope_key, item_id)`;

export const EXTENSION_DATA_DROP_OLD_INDEX_SQL = `DROP INDEX IF EXISTS tool_data_scope_item_idx`;
export const EXTENSION_DATA_DROP_OLD_INDEX_SQL_PG = `DROP INDEX IF EXISTS tool_data_scope_item_idx`;

export const EXTENSIONS_OWNER_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tools_owner_idx ON tools (owner_email)`;
export const EXTENSIONS_ORG_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tools_org_idx ON tools (org_id)`;
export const EXTENSION_SHARES_RESOURCE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tool_shares_resource_idx ON tool_shares (resource_id)`;

// ---------------------------------------------------------------------------
// extension_consents — vestigial, kept for additive-schema compliance
// ---------------------------------------------------------------------------
//
// Originally added for an audit-C1 per-(viewer, extension, content_hash)
// consent gate that prompted viewers to "Run anyway" before non-author
// extensions could execute. We removed the runtime gate after settling on
// intra-org trust (extensions are shared between trusted teammates; the
// org-level access controls are sufficient). The table is kept here so
// deploys that already ran the migration stay healthy — additive-only schema
// policy means we never drop. Physical name stays `tool_consents`.

export const extensionConsents = table("tool_consents", {
  viewerEmail: text("viewer_email").notNull(),
  extensionId: text("tool_id").notNull(),
  contentHash: text("content_hash").notNull(),
  grantedAt: text("granted_at").notNull().default(now()),
});

export const EXTENSION_CONSENTS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS tool_consents (
  viewer_email TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (viewer_email, tool_id, content_hash)
)`;

export const EXTENSION_CONSENTS_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS tool_consents (
  viewer_email TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_email, tool_id, content_hash)
)`;

export const EXTENSION_CONSENTS_VIEWER_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tool_consents_viewer_idx ON tool_consents (viewer_email, tool_id)`;
