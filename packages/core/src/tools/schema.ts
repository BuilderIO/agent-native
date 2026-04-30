/**
 * Drizzle schema for the framework tools system.
 *
 * Tools are mini Alpine.js apps that run inside sandboxed iframes. They can
 * call external APIs via a server-side proxy that resolves `${keys.NAME}`
 * secret references. Tools use the standard sharing model (private by default,
 * shareable with org/others).
 *
 * The tables are auto-created at server boot via `ensureTable()` in store.ts,
 * following the same pattern as `app_secrets`.
 */

import { table, text, now } from "../db/schema.js";
import { ownableColumns, createSharesTable } from "../sharing/schema.js";

export const tools = table("tools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  content: text("content").notNull().default(""),
  icon: text("icon"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const toolShares = createSharesTable("tool_shares");

export const TOOLS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS tools (
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

export const TOOLS_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS tools (
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

export const TOOL_SHARES_CREATE_SQL = `CREATE TABLE IF NOT EXISTS tool_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export const TOOL_SHARES_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS tool_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
)`;

export const toolData = table("tool_data", {
  id: text("id").primaryKey(),
  toolId: text("tool_id").notNull(),
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

export const TOOL_DATA_CREATE_SQL = `CREATE TABLE IF NOT EXISTS tool_data (
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

export const TOOL_DATA_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS tool_data (
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

export const TOOL_DATA_ITEM_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS tool_data_scoped_item_idx
  ON tool_data (tool_id, collection, scope_key, item_id)`;

export const TOOL_DATA_ITEM_INDEX_SQL_PG = `CREATE UNIQUE INDEX IF NOT EXISTS tool_data_scoped_item_idx
  ON tool_data (tool_id, collection, scope_key, item_id)`;

export const TOOL_DATA_DROP_OLD_INDEX_SQL = `DROP INDEX IF EXISTS tool_data_scope_item_idx`;
export const TOOL_DATA_DROP_OLD_INDEX_SQL_PG = `DROP INDEX IF EXISTS tool_data_scope_item_idx`;

export const TOOLS_OWNER_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tools_owner_idx ON tools (owner_email)`;
export const TOOLS_ORG_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tools_org_idx ON tools (org_id)`;
export const TOOL_SHARES_RESOURCE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tool_shares_resource_idx ON tool_shares (resource_id)`;

// ---------------------------------------------------------------------------
// tool_consents — per-(viewer, tool, content_hash) trust gates
// ---------------------------------------------------------------------------
//
// SECURITY (audit C1, see security-audit/05-tools-sandbox.md): a shared tool
// runs the author's HTML/JS inside the *viewer's* session, with the viewer's
// secrets, action permissions, and SQL scope. We therefore require explicit
// per-viewer consent before executing a non-author's tool — and we tie the
// consent to a SHA-256 of the rendered content, so any subsequent edit by the
// author re-prompts the viewer instead of silently inheriting trust.
//
// Additive only: this table never replaces existing rows; revocation deletes
// rows for a (viewer, tool) pair. Never DROP COLUMN, never ALTER.

export const toolConsents = table("tool_consents", {
  viewerEmail: text("viewer_email").notNull(),
  toolId: text("tool_id").notNull(),
  contentHash: text("content_hash").notNull(),
  grantedAt: text("granted_at").notNull().default(now()),
});

export const TOOL_CONSENTS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS tool_consents (
  viewer_email TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (viewer_email, tool_id, content_hash)
)`;

export const TOOL_CONSENTS_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS tool_consents (
  viewer_email TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_email, tool_id, content_hash)
)`;

export const TOOL_CONSENTS_VIEWER_INDEX_SQL = `CREATE INDEX IF NOT EXISTS tool_consents_viewer_idx ON tool_consents (viewer_email, tool_id)`;
