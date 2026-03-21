import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema for the file sync adapter.
 *
 * Table schema:
 *   files(id TEXT PK, path TEXT, content TEXT, app TEXT, owner_id TEXT,
 *         last_updated INTEGER, created_at INTEGER)
 *
 * CREATE INDEX idx_files_app_owner ON files(app, owner_id);
 */
export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
  content: text("content").notNull(),
  app: text("app").notNull(),
  ownerId: text("owner_id").notNull(),
  lastUpdated: integer("last_updated", { mode: "number" }).notNull(),
  createdAt: integer("created_at", { mode: "number" }),
});
