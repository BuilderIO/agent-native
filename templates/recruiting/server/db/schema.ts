import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const agentNotes = sqliteTable("agent_notes", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  content: text("content").notNull(),
  type: text("type").notNull(),
  createdAt: integer("created_at").notNull(),
  ownerEmail: text("owner_email"),
});
