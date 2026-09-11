import { boolean } from "drizzle-orm/pg-core";

import { table, text, integer, ownableColumns } from "../../db/schema.js";

export const contextDirectives = table("context_directives", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  segmentId: text("segment_id").notNull(),
  action: text("action", { enum: ["pin", "evict", "summarize"] }).notNull(),
  summaryText: text("summary_text"),
  createdBy: text("created_by", { enum: ["user", "agent"] })
    .notNull()
    .default("user"),
  active: boolean("active").notNull().default(true),
  originTurn: text("origin_turn"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  ...ownableColumns(),
});
