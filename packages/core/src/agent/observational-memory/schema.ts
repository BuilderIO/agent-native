import { table, text, integer, ownableColumns } from "../../db/schema.js";

export const observationalMemory = table("observational_memory", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  tier: text("tier", { enum: ["observation", "reflection"] }).notNull(),
  text: text("text").notNull(),
  tokenEstimate: integer("token_estimate").notNull().default(0),
  sourceStartIndex: integer("source_start_index"),
  sourceEndIndex: integer("source_end_index"),
  sourceMessageCount: integer("source_message_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  ...ownableColumns(),
});
