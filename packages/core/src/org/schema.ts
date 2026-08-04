import { table, text, integer } from "../db/schema.js";

export const organizations = table("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  allowedDomain: text("allowed_domain"),
  a2aSecret: text("a2a_secret"),
  workspaceUrl: text("workspace_url"),
  requiredAuthProvider: text("required_auth_provider"),
});

export const orgMembers = table("org_members", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  joinedAt: integer("joined_at").notNull(),
});

/**
 * Per-app role assignments, keyed to an existing `org_members` row. An app role
 * only narrows what a member may do inside one app; it never grants membership,
 * and it never implies an org role.
 */
export const appMemberRoles = table("app_member_roles", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  appId: text("app_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const orgInvitations = table("org_invitations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  invitedBy: text("invited_by").notNull(),
  createdAt: integer("created_at").notNull(),
  status: text("status").notNull(),
  role: text("role"),
});
