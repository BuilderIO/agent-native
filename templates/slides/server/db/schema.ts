import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const decks = table("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(), // Full deck JSON
  designSystemId: text("design_system_id"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const deckShares = createSharesTable("deck_shares");

export const deckVersions = table("deck_versions", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  deckId: text("deck_id").notNull(),
  title: text("title").notNull(),
  data: text("data").notNull(),
  changeLabel: text("change_label"),
  createdAt: text("created_at").notNull().default(now()),
});

export const designSystems = table("design_systems", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  data: text("data").notNull(),
  assets: text("assets"),
  customInstructions: text("custom_instructions").notNull().default(""),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designSystemShares = createSharesTable("design_system_shares");

// Persisted public share-link snapshots (token → deck snapshot).
// Replaces the old in-memory Map so links survive server restarts and
// work across multiple serverless instances.
export const deckShareLinks = table("deck_share_links", {
  token: text("token").primaryKey(),
  title: text("title").notNull(),
  slides: text("slides").notNull(), // JSON array of slide snapshots
  aspectRatio: text("aspect_ratio"),
  designSystemData: text("design_system_data"), // Share-safe token snapshot
  createdAt: text("created_at").notNull().default(now()),
});

export const uploadedAssets = table("uploaded_assets", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  url: text("url").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  provider: text("provider"),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});

export const slideComments = table("slide_comments", {
  id: text("id").primaryKey(),
  deckId: text("deck_id").notNull(),
  slideId: text("slide_id").notNull(),
  threadId: text("thread_id").notNull(),
  parentId: text("parent_id"),
  content: text("content").notNull(),
  quotedText: text("quoted_text"),
  authorEmail: text("author_email").notNull(),
  authorName: text("author_name"),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const deckEvents = table("deck_events", {
  id: text("id").primaryKey(),
  deckId: text("deck_id").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  payload: text("payload"),
  createdBy: text("created_by").notNull().default("human"),
  createdAt: text("created_at").notNull().default(now()),
});

// One durable bucket per deck keeps anonymous access-request throttling
// consistent across serverless instances and cold starts.
export const deckAccessRequestLimits = table("deck_access_request_limits", {
  deckId: text("deck_id").primaryKey(),
  windowStartedAt: text("window_started_at").notNull(),
  requestCount: integer("request_count").notNull().default(0),
});

export const exportArtifacts = table("export_artifacts", {
  id: text("id").primaryKey(),
  blobHandle: text("blob_handle").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});

export const webhookSubscriptions = table("webhook_subscriptions", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  events: text("events").notNull(),
  secret: text("secret").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  disabledReason: text("disabled_reason"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const webhookDeliveries = table("webhook_deliveries", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull(),
  event: text("event").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: text("next_attempt_at"),
  claimedAt: text("claimed_at"),
  claimExpiresAt: text("claim_expires_at"),
  lastError: text("last_error"),
  deliveredAt: text("delivered_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});
