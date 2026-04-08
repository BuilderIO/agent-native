import { table, text, integer, now } from "@agent-native/core/db/schema";

export const documents = table("documents", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  title: text("title").notNull().default("Untitled"),
  content: text("content").notNull().default(""),
  icon: text("icon"),
  position: integer("position").notNull().default(0),
  isFavorite: integer("is_favorite").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const documentVersions = table("document_versions", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});

export const documentComments = table("document_comments", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  threadId: text("thread_id").notNull(),
  parentId: text("parent_id"),
  content: text("content").notNull(),
  quotedText: text("quoted_text"),
  authorEmail: text("author_email").notNull(),
  authorName: text("author_name"),
  resolved: integer("resolved").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  notionCommentId: text("notion_comment_id"),
});

export const documentSyncLinks = table("document_sync_links", {
  documentId: text("document_id").primaryKey(),
  provider: text("provider").notNull().default("notion"),
  remotePageId: text("remote_page_id").notNull(),
  state: text("state").notNull().default("linked"),
  lastSyncedAt: text("last_synced_at"),
  lastPulledRemoteUpdatedAt: text("last_pulled_remote_updated_at"),
  lastPushedLocalUpdatedAt: text("last_pushed_local_updated_at"),
  lastKnownRemoteUpdatedAt: text("last_known_remote_updated_at"),
  lastError: text("last_error"),
  warningsJson: text("warnings_json"),
  hasConflict: integer("has_conflict").notNull().default(0),
  syncComments: integer("sync_comments").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});
