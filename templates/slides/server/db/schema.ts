import {
  index,
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
  uniqueIndex,
} from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

export const decks = table("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(), // Full deck JSON
  designSystemId: text("design_system_id"),
  lastWriteClientId: text("last_write_client_id"),
  lastWriteClientSequence: integer("last_write_client_sequence"),
  lastWriteRevision: text("last_write_revision"),
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
  chatContext: text("chat_context"),
  changeGroup: text("change_group"),
  createdAt: text("created_at").notNull().default(now()),
});

export const designSystems = table("design_systems", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  data: text("data").notNull(),
  assets: text("assets"),
  customInstructions: text("custom_instructions").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designSystemShares = createSharesTable("design_system_shares");

export const deckShareLinks = table("deck_share_links", {
  token: text("token").primaryKey(),
  title: text("title").notNull(),
  slides: text("slides").notNull(), // JSON array of slide snapshots
  aspectRatio: text("aspect_ratio"),
  designSystemData: text("design_system_data"), // Share-safe token snapshot
  createdAt: text("created_at").notNull().default(now()),
});

export const uploadedAssets = table(
  "uploaded_assets",
  {
    id: text("id").primaryKey(),
    filename: text("filename").notNull(),
    url: text("url").notNull(),
    type: text("type").notNull(),
    size: integer("size").notNull(),
    provider: text("provider"),
    providerObjectId: text("provider_object_id"),
    uploadSessionId: text("upload_session_id"),
    orgId: text("org_id"),
    ownerEmail: text("owner_email").notNull(),
    createdAt: text("created_at").notNull().default(now()),
  },
  (asset) => ({
    uploadSessionUniqueIdx: uniqueIndex(
      "uploaded_assets_owner_upload_session_uidx",
    ).on(asset.ownerEmail, asset.uploadSessionId),
  }),
);

export const slideComments = table(
  "slide_comments",
  {
    id: text("id").primaryKey(),
    deckId: text("deck_id").notNull(),
    slideId: text("slide_id").notNull(),
    threadId: text("thread_id").notNull(),
    parentId: text("parent_id"),
    content: text("content").notNull(),
    quotedText: text("quoted_text"),
    anchor: text("anchor"),
    emojiReactionsJson: text("emoji_reactions_json").notNull().default("{}"),
    authorEmail: text("author_email").notNull(),
    authorName: text("author_name"),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (comment) => ({
    deckCreatedIdx: index("slide_comments_deck_created_idx").on(
      comment.deckId,
      comment.createdAt,
    ),
    deckSlideCreatedIdx: index("slide_comments_deck_slide_created_idx").on(
      comment.deckId,
      comment.slideId,
      comment.createdAt,
    ),
  }),
);

export const deckEvents = table("deck_events", {
  id: text("id").primaryKey(),
  deckId: text("deck_id").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  payload: text("payload"),
  createdBy: text("created_by").notNull().default("human"),
  createdAt: text("created_at").notNull().default(now()),
});

export const deckAccessRequestLimits = table("deck_access_request_limits", {
  deckId: text("deck_id").primaryKey(),
  windowStartedAt: text("window_started_at").notNull(),
  requestCount: integer("request_count").notNull().default(0),
});

/** One row per deck whose `slide_comments` were copied into the review store. */
export const slideCommentReviewMigrations = table(
  "slide_comment_review_migrations",
  {
    deckId: text("deck_id").primaryKey(),
    importedCount: integer("imported_count").notNull().default(0),
    migratedAt: text("migrated_at").notNull(),
  },
);

export const slideReviewAgentRequests = table(
  "slide_review_agent_requests",
  {
    id: text("id").primaryKey(),
    deckId: text("deck_id").notNull(),
    threadId: text("thread_id").notNull(),
    rootCommentId: text("root_comment_id").notNull(),
    triggerCommentId: text("trigger_comment_id"),
    slideId: text("slide_id"),
    requesterEmail: text("requester_email").notNull(),
    status: text("status").notNull().default("queued"),
    agentThreadId: text("agent_thread_id").notNull(),
    agentTurnId: text("agent_turn_id").notNull(),
    model: text("model"),
    engine: text("engine"),
    replyCommentId: text("reply_comment_id"),
    errorCode: text("error_code"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (request) => ({
    deckUpdatedIdx: index("slide_review_agent_requests_deck_updated_idx").on(
      request.deckId,
      request.updatedAt,
    ),
    agentThreadIdx: index("slide_review_agent_requests_agent_thread_idx").on(
      request.agentThreadId,
    ),
  }),
);
