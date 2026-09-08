import { table, text, integer, bigint } from "../db/schema.js";
import { createSharesTable, ownableColumns } from "../sharing/schema.js";

export const chatThreads = table("chat_threads", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  preview: text("preview").notNull().default(""),
  threadData: text("thread_data").notNull().default("{}"),
  messageCount: integer("message_count").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  scopeType: text("scope_type"),
  scopeId: text("scope_id"),
  scopeLabel: text("scope_label"),
  pinnedAt: bigint("pinned_at", { mode: "number" }),
  archivedAt: bigint("archived_at", { mode: "number" }),
  shareTokenHash: text("share_token_hash"),
  sourcePlatform: text("source_platform"),
  sourceAppId: text("source_app_id"),
  sourceUrl: text("source_url"),
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
  created_at TEXT NOT NULL DEFAULT now()
)`;

export const CHAT_THREAD_SHARES_RESOURCE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS chat_thread_shares_resource_idx ON chat_thread_shares (resource_id)`;
