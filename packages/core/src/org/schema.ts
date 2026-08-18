import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "../db/schema.js";

export const organizations = table("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  allowedDomain: text("allowed_domain"),
  a2aSecret: text("a2a_secret"),
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
  role: text("role"),
});

/** Reusable organization principals for sharing resources and workspace apps. */
export const orgGroups = table("org_groups", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const orgGroupMembers = table("org_group_members", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  groupId: text("group_id").notNull(),
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Workspace app access is framework-owned so every mounted app can enforce it. */
export const workspaceApps = table("workspace_apps", {
  id: text("id").primaryKey(),
  ...ownableColumns(),
  // Workspace apps are visible to their organization by default. The generic
  // ownable primitive remains private-by-default for user-created resources;
  // app creation is a deliberate workspace-level exception.
  visibility: text("visibility", {
    enum: ["private", "org", "public"],
  })
    .notNull()
    .default("org"),
  name: text("name").notNull(),
  description: text("description"),
  path: text("path").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const workspaceAppShares = createSharesTable("workspace_app_shares");
