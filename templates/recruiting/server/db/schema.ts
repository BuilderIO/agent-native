import { table, text, integer } from "@agent-native/core/db/schema";

export const agentNotes = table("agent_notes", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  content: text("content").notNull(),
  type: text("type").notNull(),
  createdAt: integer("created_at").notNull(),
  ownerEmail: text("owner_email"),
  orgId: text("org_id"),
});
