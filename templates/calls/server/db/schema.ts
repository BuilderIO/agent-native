import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

// -----------------------------------------------------------------------------
// Workspaces & members
// -----------------------------------------------------------------------------

export const workspaces = table("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default("My Workspace"),
  slug: text("slug").notNull(),
  brandColor: text("brand_color").notNull().default("#111111"),
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
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#111111"),
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
  workspaceId: text("workspace_id").notNull(),
  parentId: text("parent_id"),
  spaceId: text("space_id"),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  name: text("name").notNull().default("Untitled folder"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Calls — the core resource
// -----------------------------------------------------------------------------

export const calls = table("calls", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  folderId: text("folder_id"),
  spaceIds: text("space_ids").notNull().default("[]"),

  // Capture origin
  source: text("source", {
    enum: ["upload", "browser", "recall-bot", "zoom-cloud"],
  })
    .notNull()
    .default("upload"),
  sourceMeta: text("source_meta").notNull().default("{}"),

  title: text("title").notNull().default("Untitled call"),
  description: text("description").notNull().default(""),
  accountId: text("account_id"),
  dealStage: text("deal_stage"),

  // Media
  thumbnailUrl: text("thumbnail_url"),
  durationMs: integer("duration_ms").notNull().default(0),
  mediaUrl: text("media_url"),
  mediaKind: text("media_kind", { enum: ["video", "audio"] })
    .notNull()
    .default("video"),
  mediaFormat: text("media_format").notNull().default("mp4"),
  mediaSizeBytes: integer("media_size_bytes").notNull().default(0),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  recordedAt: text("recorded_at"),
  timezone: text("timezone"),

  // Pipeline
  status: text("status", {
    enum: [
      "uploading",
      "processing",
      "transcribing",
      "analyzing",
      "ready",
      "failed",
    ],
  })
    .notNull()
    .default("uploading"),
  progressPct: integer("progress_pct").notNull().default(0),
  failureReason: text("failure_reason"),

  // Sharing additions on top of framework sharing
  password: text("password"),
  expiresAt: text("expires_at"),
  shareIncludesSummary: integer("share_includes_summary", { mode: "boolean" })
    .notNull()
    .default(true),
  shareIncludesTranscript: integer("share_includes_transcript", {
    mode: "boolean",
  })
    .notNull()
    .default(false),

  enableComments: integer("enable_comments", { mode: "boolean" })
    .notNull()
    .default(true),
  enableDownloads: integer("enable_downloads", { mode: "boolean" })
    .notNull()
    .default(false),
  defaultSpeed: text("default_speed").notNull().default("1.0"),

  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  archivedAt: text("archived_at"),
  trashedAt: text("trashed_at"),
  ...ownableColumns(),
});

export const callShares = createSharesTable("call_shares");

// -----------------------------------------------------------------------------
// Call participants — one row per diarized speaker
// -----------------------------------------------------------------------------

export const callParticipants = table("call_participants", {
  id: text("id").primaryKey(),
  callId: text("call_id").notNull(),
  speakerLabel: text("speaker_label").notNull(),
  displayName: text("display_name"),
  email: text("email"),
  isInternal: integer("is_internal", { mode: "boolean" })
    .notNull()
    .default(false),
  avatarUrl: text("avatar_url"),
  color: text("color").notNull().default("#111111"),
  talkMs: integer("talk_ms").notNull().default(0),
  talkPct: integer("talk_pct").notNull().default(0),
  longestMonologueMs: integer("longest_monologue_ms").notNull().default(0),
  interruptionsCount: integer("interruptions_count").notNull().default(0),
  questionsCount: integer("questions_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Transcripts — diarized segments + full text for search
// -----------------------------------------------------------------------------

export const callTranscripts = table("call_transcripts", {
  callId: text("call_id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  language: text("language").notNull().default("en"),
  provider: text("provider", {
    enum: ["deepgram", "assemblyai", "whisper"],
  })
    .notNull()
    .default("deepgram"),
  segmentsJson: text("segments_json").notNull().default("[]"),
  fullText: text("full_text").notNull().default(""),
  status: text("status", { enum: ["pending", "ready", "failed"] })
    .notNull()
    .default("pending"),
  failureReason: text("failure_reason"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// AI summaries — Recap / Key Points / Next Steps / Topics / Questions
// -----------------------------------------------------------------------------

export const callSummaries = table("call_summaries", {
  callId: text("call_id").primaryKey(),
  recap: text("recap").notNull().default(""),
  keyPointsJson: text("key_points_json").notNull().default("[]"),
  nextStepsJson: text("next_steps_json").notNull().default("[]"),
  topicsJson: text("topics_json").notNull().default("[]"),
  questionsJson: text("questions_json").notNull().default("[]"),
  actionItemsJson: text("action_items_json").notNull().default("[]"),
  sentiment: text("sentiment"),
  generatedBy: text("generated_by").notNull().default("agent"),
  generatedAt: text("generated_at"),
  updatedAt: text("updated_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Trackers — per-workspace definitions + per-call hits
// -----------------------------------------------------------------------------

export const trackerDefinitions = table("tracker_definitions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  kind: text("kind", { enum: ["keyword", "smart"] })
    .notNull()
    .default("keyword"),
  keywordsJson: text("keywords_json").notNull().default("[]"),
  classifierPrompt: text("classifier_prompt"),
  color: text("color").notNull().default("#111111"),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const trackerHits = table("tracker_hits", {
  id: text("id").primaryKey(),
  callId: text("call_id").notNull(),
  trackerId: text("tracker_id").notNull(),
  speakerLabel: text("speaker_label"),
  segmentStartMs: integer("segment_start_ms").notNull().default(0),
  segmentEndMs: integer("segment_end_ms").notNull().default(0),
  quote: text("quote").notNull().default(""),
  confidence: integer("confidence").notNull().default(100),
  createdAt: text("created_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Snippets — shareable moments (pointer-only, no re-encode)
// -----------------------------------------------------------------------------

export const snippets = table("snippets", {
  id: text("id").primaryKey(),
  callId: text("call_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull().default("Untitled snippet"),
  description: text("description").notNull().default(""),
  startMs: integer("start_ms").notNull().default(0),
  endMs: integer("end_ms").notNull().default(0),
  password: text("password"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  trashedAt: text("trashed_at"),
  ...ownableColumns(),
});

export const snippetShares = createSharesTable("snippet_shares");

// -----------------------------------------------------------------------------
// Tags
// -----------------------------------------------------------------------------

export const callTags = table("call_tags", {
  id: text("id").primaryKey(),
  callId: text("call_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  tag: text("tag").notNull(),
});

// -----------------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------------

export const callComments = table("call_comments", {
  id: text("id").primaryKey(),
  callId: text("call_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  threadId: text("thread_id").notNull(),
  parentId: text("parent_id"),
  authorEmail: text("author_email").notNull(),
  authorName: text("author_name"),
  content: text("content").notNull(),
  videoTimestampMs: integer("video_timestamp_ms").notNull().default(0),
  emojiReactionsJson: text("emoji_reactions_json").notNull().default("{}"),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Analytics — viewers + granular events
// -----------------------------------------------------------------------------

export const callViewers = table("call_viewers", {
  id: text("id").primaryKey(),
  callId: text("call_id").notNull(),
  viewerEmail: text("viewer_email"),
  viewerName: text("viewer_name"),
  firstViewedAt: text("first_viewed_at").notNull().default(now()),
  lastViewedAt: text("last_viewed_at").notNull().default(now()),
  totalWatchMs: integer("total_watch_ms").notNull().default(0),
  completedPct: integer("completed_pct").notNull().default(0),
  countedView: integer("counted_view", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const callEvents = table("call_events", {
  id: text("id").primaryKey(),
  callId: text("call_id").notNull(),
  viewerId: text("viewer_id"),
  kind: text("kind", {
    enum: [
      "view-start",
      "watch-progress",
      "seek",
      "pause",
      "resume",
      "reaction",
    ],
  }).notNull(),
  timestampMs: integer("timestamp_ms").notNull().default(0),
  payload: text("payload").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
});

export const snippetViewers = table("snippet_viewers", {
  id: text("id").primaryKey(),
  snippetId: text("snippet_id").notNull(),
  viewerEmail: text("viewer_email"),
  viewerName: text("viewer_name"),
  firstViewedAt: text("first_viewed_at").notNull().default(now()),
  lastViewedAt: text("last_viewed_at").notNull().default(now()),
  totalWatchMs: integer("total_watch_ms").notNull().default(0),
  completedPct: integer("completed_pct").notNull().default(0),
  countedView: integer("counted_view", { mode: "boolean" })
    .notNull()
    .default(false),
});

// -----------------------------------------------------------------------------
// Recall.ai bot lifecycle
// -----------------------------------------------------------------------------

export const recallBots = table("recall_bots", {
  id: text("id").primaryKey(),
  callId: text("call_id"),
  workspaceId: text("workspace_id").notNull(),
  meetingUrl: text("meeting_url").notNull(),
  status: text("status", {
    enum: ["scheduled", "joining", "recording", "done", "failed"],
  })
    .notNull()
    .default("scheduled"),
  scheduledAt: text("scheduled_at"),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  createdBy: text("created_by").notNull(),
  rawJson: text("raw_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Zoom OAuth per-user (tokens encrypted via framework encryption)
// -----------------------------------------------------------------------------

export const zoomConnections = table("zoom_connections", {
  email: text("email").primaryKey(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresAt: text("expires_at").notNull(),
  autoImport: integer("auto_import", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Accounts (CRM-lite tagging)
// -----------------------------------------------------------------------------

export const accounts = table("accounts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  domain: text("domain"),
  logoUrl: text("logo_url"),
  createdAt: text("created_at").notNull().default(now()),
});

// -----------------------------------------------------------------------------
// Saved library views (stored filter chip state)
// -----------------------------------------------------------------------------

export const savedViews = table("saved_views", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  name: text("name").notNull(),
  filtersJson: text("filters_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
});
