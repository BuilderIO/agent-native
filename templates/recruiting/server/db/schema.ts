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

export const organizations = table("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Composite PK (org_id, email) defined in migration SQL.
// Drizzle uses this for typed queries; the id column is a synthetic PK for ORM compat.
export const orgMembers = table("org_members", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  joinedAt: integer("joined_at").notNull(),
});

export const orgInvitations = table("org_invitations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  invitedBy: text("invited_by").notNull(),
  createdAt: integer("created_at").notNull(),
  status: text("status").notNull(),
});
