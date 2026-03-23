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
