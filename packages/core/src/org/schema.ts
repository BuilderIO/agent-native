import {
  table,
  text,
  bigint,
  boolean,
  ownableColumns,
  createSharesTable,
} from "../db/schema.js";

export const organizations = table("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // guard:allow-identity-column — immutable organization creation provenance
  createdBy: text("created_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  allowedDomain: text("allowed_domain"),
  a2aSecret: text("a2a_secret"),
  workspaceUrl: text("workspace_url"),
  requiredAuthProvider: text("required_auth_provider"),
  /** Stable Dispatch identity used to match this org across app databases. */
  identityAuthority: text("identity_authority"),
  identityId: text("identity_id"),
  /** Canonical versioned IconValue JSON; null means no workspace override. */
  iconJson: text("icon_json"),
  /** Monotonic authority revision used when identity is copied across apps. */
  iconRevision: bigint("icon_revision", { mode: "number" })
    .notNull()
    .default(0),
  /** Set after the identity authority has accepted the initial member roster. */
  federationRosterInitializedAt: bigint("federation_roster_initialized_at", {
    mode: "number",
  }),
});

export const orgMembers = table("org_members", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  joinedAt: bigint("joined_at", { mode: "number" }).notNull(),
  /** Restrictive marker retained if authority revocation beats local deletion. */
  federationRemovalPendingAt: bigint("federation_removal_pending_at", {
    mode: "number",
  }),
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
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const appPermissionOverrides = table("app_permission_overrides", {
  orgId: text("org_id").notNull(),
  appId: text("app_id").notNull(),
  permission: text("permission").notNull(),
  rolesJson: text("roles_json").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

/**
 * Durable SCIM-to-framework membership ownership marker. This row intentionally
 * stores only Better Auth's immutable user id, never an email identity. A
 * `createdMembership=false` row means SCIM must leave an existing human-managed
 * membership in place when the directory deactivates the user.
 */
export const orgScimMemberships = table("org_scim_memberships", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  // guard:allow-identity-column - immutable Better Auth user id
  userId: text("user_id").notNull(),
  /** The framework member row SCIM created, if any. */
  memberId: text("member_id"),
  createdMembership: boolean("created_membership").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const orgInvitations = table("org_invitations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  invitedBy: text("invited_by").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  status: text("status").notNull(),
  role: text("role"),
  appRolesJson: text("app_roles_json"),
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
  orgEnabled: boolean("org_enabled").notNull().default(true),
  name: text("name").notNull(),
  description: text("description"),
  path: text("path").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const workspaceAppShares = createSharesTable("workspace_app_shares");
