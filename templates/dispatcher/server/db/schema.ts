import { table, text, integer } from "@agent-native/core/db/schema";

export const dispatcherDestinations = table("dispatcher_destinations", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  destination: text("destination").notNull(),
  threadRef: text("thread_ref"),
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const dispatcherIdentityLinks = table("dispatcher_identity_links", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  platform: text("platform").notNull(),
  externalUserId: text("external_user_id").notNull(),
  externalUserName: text("external_user_name"),
  linkedBy: text("linked_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const dispatcherLinkTokens = table("dispatcher_link_tokens", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  platform: text("platform").notNull(),
  createdBy: text("created_by").notNull(),
  expiresAt: integer("expires_at").notNull(),
  claimedAt: integer("claimed_at"),
  claimedByExternalUserId: text("claimed_by_external_user_id"),
  claimedByExternalUserName: text("claimed_by_external_user_name"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const dispatcherApprovalRequests = table(
  "dispatcher_approval_requests",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    changeType: text("change_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    status: text("status").notNull(),
    summary: text("summary").notNull(),
    payload: text("payload").notNull(),
    beforeValue: text("before_value"),
    afterValue: text("after_value"),
    requestedBy: text("requested_by").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
);

export const dispatcherAuditEvents = table("dispatcher_audit_events", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  summary: text("summary").notNull(),
  metadata: text("metadata"),
  createdAt: integer("created_at").notNull(),
});
