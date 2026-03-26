import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  title: text("title").notNull().default("Untitled"),
  content: text("content").notNull().default(""),
  icon: text("icon"),
  position: integer("position").notNull().default(0),
  isFavorite: integer("is_favorite").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const documentSyncLinks = sqliteTable("document_sync_links", {
  documentId: text("document_id").primaryKey(),
  provider: text("provider").notNull().default("notion"),
  remotePageId: text("remote_page_id").notNull(),
  state: text("state").notNull().default("linked"),
  lastSyncedAt: text("last_synced_at"),
  lastPulledRemoteUpdatedAt: text("last_pulled_remote_updated_at"),
  lastPushedLocalUpdatedAt: text("last_pushed_local_updated_at"),
  lastKnownRemoteUpdatedAt: text("last_known_remote_updated_at"),
  lastError: text("last_error"),
  warningsJson: text("warnings_json"),
  hasConflict: integer("has_conflict").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
