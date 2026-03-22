import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  workspace: text("workspace").notNull(),
  project: text("project").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(), // Markdown content
  metadata: text("metadata"), // JSON project metadata
  publishedAt: text("published_at"),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});
