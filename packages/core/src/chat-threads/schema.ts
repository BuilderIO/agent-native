import { table, text, integer } from "../db/schema.js";
import { createSharesTable, ownableColumns } from "../sharing/schema.js";

export const chatThreads = table("chat_threads", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  preview: text("preview").notNull().default(""),
  threadData: text("thread_data").notNull().default("{}"),
  messageCount: integer("message_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  scopeType: text("scope_type"),
  scopeId: text("scope_id"),
  scopeLabel: text("scope_label"),
  pinnedAt: integer("pinned_at"),
  archivedAt: integer("archived_at"),
  shareTokenHash: text("share_token_hash"),
  ...ownableColumns(),
});

export const chatThreadShares = createSharesTable("chat_thread_shares");

export const CHAT_THREAD_SHARES_CREATE_SQL = `CREATE TABLE IF NOT EXISTS chat_thread_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export const CHAT_THREAD_SHARES_CREATE_SQL_PG = `CREATE TABLE IF NOT EXISTS chat_thread_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
)`;

export const CHAT_THREAD_SHARES_RESOURCE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS chat_thread_shares_resource_idx ON chat_thread_shares (resource_id)`;
