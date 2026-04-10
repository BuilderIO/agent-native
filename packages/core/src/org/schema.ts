import { table, text, integer } from "../db/schema.js";

export const organizations = table("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

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
