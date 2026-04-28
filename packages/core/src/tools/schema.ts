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
  itemId: text("item_id").notNull(),
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
  item_id TEXT NOT NULL,
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
  item_id TEXT NOT NULL,
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
