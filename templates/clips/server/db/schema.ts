import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

// -----------------------------------------------------------------------------
// Organizations (new canonical "team" primitive, powered by better-auth).
//
// Team / member / invitation rows live in better-auth's own tables:
//   `organization`, `member`, `invitation` — managed by the framework.
//
// `organization_settings` is the Clips-specific sidecar: brand color, logo,
// default visibility — one row per organization, keyed by `organization.id`.
//
// -----------------------------------------------------------------------------
// Workspaces & members (DEPRECATED — kept only for the in-place migration
// from the old Clips workspace model to better-auth orgs. Every new Clips
// deploy auto-backfills an `organization` + `organization_settings` row for
// every workspace row at startup (see `server/plugins/db.ts`), keeping the
// same id across both. Actions and UI will migrate off these tables in a
// follow-up; at that point these table definitions can be deleted.)
// -----------------------------------------------------------------------------

export const organizationSettings = table("organization_settings", {
  organizationId: text("organization_id").primaryKey(),
  brandColor: text("brand_color").notNull().default("#18181B"),
  brandLogoUrl: text("brand_logo_url"),
  defaultVisibility: text("default_visibility", {
    enum: ["private", "org", "public"],
  })
    .notNull()
    .default("private"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const workspaces = table("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default("My Workspace"),
  slug: text("slug").notNull(),
  brandColor: text("brand_color").notNull().default("#18181B"),
  brandLogoUrl: text("brand_logo_url"),
  defaultVisibility: text("default_visibility", {
    enum: ["private", "org", "public"],
  })
    .notNull()
    .default("private"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const workspaceMembers = table("workspace_members", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  email: text("email").notNull(),
  role: text("role", {
    enum: ["viewer", "creator-lite", "creator", "admin"],
  })
    .notNull()
    .default("creator"),
  invitedAt: text("invited_at"),
  joinedAt: text("joined_at"),
});

export const invites = table("invites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  email: text("email").notNull(),
  role: text("role", {
    enum: ["viewer", "creator-lite", "creator", "admin"],
  })
    .notNull()
    .default("creator"),
  token: text("token").notNull(),
  invitedBy: text("invited_by").notNull(),
  expiresAt: text("expires_at"),
  acceptedAt: text("accepted_at"),
  createdAt: text("created_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Spaces & folders
// -----------------------------------------------------------------------------

export const spaces = table("spaces", {
  id: text("id").primaryKey(),
  organizationId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#18181B"),
  iconEmoji: text("icon_emoji"),
  isAllCompany: integer("is_all_company", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull().default(now()),
});

export const spaceMembers = table("space_members", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["viewer", "contributor", "admin"] })
    .notNull()
    .default("contributor"),
});

export const folders = table("folders", {
  id: text("id").primaryKey(),
  organizationId: text("workspace_id").notNull(),
  parentId: text("parent_id"),
  spaceId: text("space_id"), // null = personal Library
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  name: text("name").notNull().default("Untitled folder"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Recordings — the core resource
// -----------------------------------------------------------------------------

export const recordings = table("recordings", {
  id: text("id").primaryKey(),
  organizationId: text("workspace_id").notNull(),
  folderId: text("folder_id"),
  spaceIds: text("space_ids").notNull().default("[]"), // JSON array of space ids

  title: text("title").notNull().default("Untitled recording"),
  description: text("description").notNull().default(""),

  thumbnailUrl: text("thumbnail_url"),
  animatedThumbnailUrl: text("animated_thumbnail_url"),

  durationMs: integer("duration_ms").notNull().default(0),
  videoUrl: text("video_url"),
  videoFormat: text("video_format", { enum: ["webm", "mp4"] })
    .notNull()
    .default("webm"),
  videoSizeBytes: integer("video_size_bytes").notNull().default(0),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  hasAudio: integer("has_audio", { mode: "boolean" }).notNull().default(true),
  hasCamera: integer("has_camera", { mode: "boolean" })
    .notNull()
    .default(false),

  status: text("status", {
    enum: ["uploading", "processing", "ready", "failed"],
  })
    .notNull()
    .default("uploading"),
  uploadProgress: integer("upload_progress").notNull().default(0),
  failureReason: text("failure_reason"),

  // Non-destructive edits: JSON `{ trims: [{startMs,endMs,excluded}], blurs: [...], speed: [...] }`
  editsJson: text("edits_json").notNull().default("{}"),
  // Chapters: JSON array of `{ startMs, title }`
  chaptersJson: text("chapters_json").notNull().default("[]"),

  // Privacy additions on top of framework sharing.
  password: text("password"),
  expiresAt: text("expires_at"),

  enableComments: integer("enable_comments", { mode: "boolean" })
    .notNull()
    .default(true),
  enableReactions: integer("enable_reactions", { mode: "boolean" })
    .notNull()
    .default(true),
  enableDownloads: integer("enable_downloads", { mode: "boolean" })
    .notNull()
    .default(true),
  defaultSpeed: text("default_speed").notNull().default("1.2"),
  animatedThumbnailEnabled: integer("animated_thumbnail_enabled", {
    mode: "boolean",
  })
    .notNull()
    .default(true),

  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  archivedAt: text("archived_at"),
  trashedAt: text("trashed_at"),

  ...ownableColumns(),
});

export const recordingShares = createSharesTable("recording_shares");

// -----------------------------------------------------------------------------
// Per-recording metadata: tags, transcripts, CTAs
// -----------------------------------------------------------------------------

export const recordingTags = table("recording_tags", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id").notNull(),
  organizationId: text("workspace_id").notNull(),
  tag: text("tag").notNull(),
});

export const recordingTranscripts = table("recording_transcripts", {
  recordingId: text("recording_id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  language: text("language").notNull().default("en"),
  // JSON array of { startMs, endMs, text }
  segmentsJson: text("segments_json").notNull().default("[]"),
  fullText: text("full_text").notNull().default(""),
  status: text("status", { enum: ["pending", "ready", "failed"] })
    .notNull()
    .default("pending"),
  failureReason: text("failure_reason"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const recordingCtas = table("recording_ctas", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id").notNull(),
  label: text("label").notNull(),
  url: text("url").notNull(),
  color: text("color").notNull().default("#18181B"),
  placement: text("placement", { enum: ["end", "throughout"] })
    .notNull()
    .default("throughout"),
  createdAt: text("created_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Comments & reactions
// -----------------------------------------------------------------------------

export const recordingComments = table("recording_comments", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id").notNull(),
  organizationId: text("workspace_id").notNull(),
  threadId: text("thread_id").notNull(),
  parentId: text("parent_id"),
  authorEmail: text("author_email").notNull(),
  authorName: text("author_name"),
  content: text("content").notNull(),
  videoTimestampMs: integer("video_timestamp_ms").notNull().default(0),
  // JSON map of emoji -> [emails]
  emojiReactionsJson: text("emoji_reactions_json").notNull().default("{}"),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const recordingReactions = table("recording_reactions", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id").notNull(),
  viewerEmail: text("viewer_email"), // nullable for anonymous viewers
  viewerName: text("viewer_name"),
  emoji: text("emoji").notNull(),
  videoTimestampMs: integer("video_timestamp_ms").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Analytics: viewers + granular events
// -----------------------------------------------------------------------------

export const recordingViewers = table("recording_viewers", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id").notNull(),
  viewerEmail: text("viewer_email"), // null = anonymous
  viewerName: text("viewer_name"),
  firstViewedAt: text("first_viewed_at").notNull().default(now()),
  lastViewedAt: text("last_viewed_at").notNull().default(now()),
  totalWatchMs: integer("total_watch_ms").notNull().default(0),
  completedPct: integer("completed_pct").notNull().default(0),
  // True once they meet the 5s / 75% / end-scrub rule.
  countedView: integer("counted_view", { mode: "boolean" })
    .notNull()
    .default(false),
  ctaClicked: integer("cta_clicked", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const recordingEvents = table("recording_events", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id").notNull(),
  viewerId: text("viewer_id"), // id on recording_viewers
  kind: text("kind", {
    enum: [
      "view-start",
      "watch-progress",
      "seek",
      "pause",
      "resume",
      "cta-click",
      "reaction",
    ],
  }).notNull(),
  // Video-time position (for progress/seek/pause/resume/reaction/cta-click).
  timestampMs: integer("timestamp_ms").notNull().default(0),
  // Optional payload (reaction emoji, cta id, etc.) — JSON.
  payload: text("payload").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
});
