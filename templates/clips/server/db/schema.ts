import {
  table,
  text,
  integer,
  real,
  now,
  ownableColumns,
  createSharesTable,
  uniqueIndex,
  index,
} from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

// Workspaces & members (DEPRECATED — kept only for the in-place migration

export const organizationSettings = table("organization_settings", {
  organizationId: text("organization_id").primaryKey(),
  brandColor: text("brand_color").notNull().default("#18181B"),
  brandLogoUrl: text("brand_logo_url"),
  defaultVisibility: text("default_visibility", {
    enum: ["private", "org", "public"],
  })
    .notNull()
    .default("public"),
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
    .default("public"),
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


export const spaces = table("spaces", {
  id: text("id").primaryKey(),
  organizationId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#18181B"),
  iconEmoji: text("icon_emoji"),
  isAllCompany: boolean("is_all_company").notNull().default(false),
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


export const recordings = table("recordings", {
  id: text("id").primaryKey(),
  organizationId: text("workspace_id").notNull(),
  folderId: text("folder_id"),
  spaceIds: text("space_ids").notNull().default("[]"), // JSON array of space ids

  title: text("title").notNull().default("Untitled recording"),
  titleSource: text("title_source", {
    enum: ["default", "context", "upload", "ai", "manual"],
  })
    .notNull()
    .default("default"),
  sourceAppName: text("source_app_name"),
  sourceWindowTitle: text("source_window_title"),
  description: text("description").notNull().default(""),

  thumbnailUrl: text("thumbnail_url"),
  // "never attempted" — every pre-migration row starts here too, which is
  thumbnailStatus: text("thumbnail_status", {
    enum: ["pending", "generated", "failed", "none"],
  }),
  thumbnailFailureReason: text("thumbnail_failure_reason"),
  animatedThumbnailUrl: text("animated_thumbnail_url"),

  filmstripUrl: text("filmstrip_url"),
  filmstripFrameCount: integer("filmstrip_frame_count").notNull().default(0),
  filmstripColumns: integer("filmstrip_columns").notNull().default(0),
  filmstripRows: integer("filmstrip_rows").notNull().default(0),
  filmstripFrameWidth: integer("filmstrip_frame_width").notNull().default(0),
  filmstripFrameHeight: integer("filmstrip_frame_height").notNull().default(0),

  durationMs: integer("duration_ms").notNull().default(0),
  videoUrl: text("video_url"),
  videoFormat: text("video_format", { enum: ["webm", "mp4"] })
    .notNull()
    .default("webm"),
  videoSizeBytes: integer("video_size_bytes").notNull().default(0),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  hasAudio: boolean("has_audio").notNull().default(true),
  hasCamera: boolean("has_camera").notNull().default(false),

  status: text("status", {
    enum: ["uploading", "processing", "ready", "failed"],
  })
    .notNull()
    .default("uploading"),
  uploadProgress: integer("upload_progress").notNull().default(0),
  uploadLeaseExpiresAt: text("upload_lease_expires_at"),
  uploadAttemptId: text("upload_attempt_id"),
  uploadGenerationId: text("upload_generation_id"),
  failureReason: text("failure_reason"),
  failureCode: text("failure_code"),
  recordingPlatform: text("recording_platform", {
    enum: ["web", "desktop", "extension", "mobile", "import", "unknown"],
  }),
  loomImportClaimId: text("loom_import_claim_id"),
  loomImportClaimedAt: text("loom_import_claimed_at"),

  editsJson: text("edits_json").notNull().default("{}"),
  chaptersJson: text("chapters_json").notNull().default("[]"),

  password: text("password"),
  expiresAt: text("expires_at"),

  enableComments: boolean("enable_comments").notNull().default(true),
  enableReactions: boolean("enable_reactions").notNull().default(true),
  enableDownloads: boolean("enable_downloads").notNull().default(true),
  defaultSpeed: text("default_speed").notNull().default("1.2"),
  animatedThumbnailEnabled: boolean("animated_thumbnail_enabled")
    .notNull()
    .default(true),

  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  mediaUpdatedAt: text("media_updated_at").notNull().default(now()),
  archivedAt: text("archived_at"),
  trashedAt: text("trashed_at"),

  ...ownableColumns(),
});

export const clipIntakeSessions = table(
  "clips_intake_sessions",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    organizationId: text("organization_id").notNull(),
    recordingId: text("recording_id"),
    status: text("status", {
      enum: ["open", "creating", "recording", "completed", "aborted"],
    })
      .notNull()
      .default("open"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (session) => ({
    expiresIndex: index("clips_intake_sessions_expires_idx").on(
      session.status,
      session.expiresAt,
    ),
  }),
);

export const recordingShares = createSharesTable("recording_shares");


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
  segmentsJson: text("segments_json").notNull().default("[]"),
  fullText: text("full_text").notNull().default(""),
  status: text("status", { enum: ["pending", "streaming", "ready", "failed"] })
    .notNull()
    .default("pending"),
  failureReason: text("failure_reason"),
  failureCode: text("failure_code"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const recordingBrowserDiagnostics = table(
  "recording_browser_diagnostics",
  {
    recordingId: text("recording_id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    organizationId: text("workspace_id").notNull(),
    orgId: text("org_id"),
    sessionId: text("session_id").notNull(),
    source: text("source", {
      enum: ["browser-recorder", "desktop", "extension"],
    })
      .notNull()
      .default("browser-recorder"),
    phase: text("phase").notNull().default("recording"),
    pageUrl: text("page_url"),
    userAgent: text("user_agent"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at").notNull(),
    consoleLogsJson: text("console_logs_json").notNull().default("[]"),
    networkRequestsJson: text("network_requests_json").notNull().default("[]"),
    interactionEventsJson: text("interaction_events_json")
      .notNull()
      .default("[]"),
    redactionVersion: integer("redaction_version").notNull().default(1),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
);

export const recordingBugReports = table("recording_bug_reports", {
  recordingId: text("recording_id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  organizationId: text("workspace_id").notNull(),
  orgId: text("org_id"),
  projectId: text("project_id"),
  title: text("title"),
  description: text("description").notNull().default(""),
  severity: text("severity", {
    enum: ["low", "normal", "high", "urgent"],
  })
    .notNull()
    .default("normal"),
  sourceUrl: text("source_url"),
  pageTitle: text("page_title"),
  appVersion: text("app_version"),
  environment: text("environment"),
  reporterEmail: text("reporter_email"),
  reporterName: text("reporter_name"),
  reporterId: text("reporter_id"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  submittedAt: text("submitted_at").notNull().default(now()),
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


export const recordingComments = table("recording_comments", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id").notNull(),
  organizationId: text("workspace_id").notNull(),
  threadId: text("thread_id").notNull(),
  parentId: text("parent_id"),
  authorEmail: text("author_email").notNull(),
  authorName: text("author_name"),
  content: text("content").notNull(),
  mentionsJson: text("mentions_json"),
  videoTimestampMs: integer("video_timestamp_ms").notNull().default(0),
  emojiReactionsJson: text("emoji_reactions_json").notNull().default("{}"),
  resolved: boolean("resolved").notNull().default(false),
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


export const recordingViewers = table(
  "recording_viewers",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id").notNull(),
    viewerKey: text("viewer_key"),
    viewerEmail: text("viewer_email"), // null = anonymous
    viewerName: text("viewer_name"),
    firstViewedAt: text("first_viewed_at").notNull().default(now()),
    lastViewedAt: text("last_viewed_at").notNull().default(now()),
    totalWatchMs: integer("total_watch_ms").notNull().default(0),
    completedPct: integer("completed_pct").notNull().default(0),
    countedView: boolean("counted_view").notNull().default(false),
    ctaClicked: boolean("cta_clicked").notNull().default(false),
  },
  (viewer) => ({
    recordingViewerKeyUnique: uniqueIndex(
      "recording_viewers_recording_viewer_key_unique_idx",
    ).on(viewer.recordingId, viewer.viewerKey),
  }),
);

export const recordingViews = table("recording_views", {
  id: text("id").primaryKey(),
  recordingId: text("recording_id").notNull(),
  viewerId: text("viewer_id").notNull(),
  viewerKey: text("viewer_key"),
  viewSessionId: text("view_session_id"),
  viewerEmail: text("viewer_email"), // null = anonymous
  viewerName: text("viewer_name"),
  viewedAt: text("viewed_at").notNull().default(now()),
});

export const recordingPlaybackPositions = table(
  "recording_playback_positions",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id").notNull(),
    viewerKey: text("viewer_key").notNull(),
    viewerEmail: text("viewer_email"),
    positionMs: integer("position_ms").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(now()),
    createdAt: text("created_at").notNull().default(now()),
  },
  (position) => ({
    recordingPlaybackPositionUnique: uniqueIndex(
      "recording_playback_positions_recording_viewer_key_unique_idx",
    ).on(position.recordingId, position.viewerKey),
  }),
);

export const recordingAgentViews = table(
  "recording_agent_views",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id").notNull(),
    agentKey: text("agent_key").notNull(),
    agentLabel: text("agent_label"),
    userAgent: text("user_agent"),
    viewSessionId: text("view_session_id").notNull(),
    firstSeenAt: text("first_seen_at").notNull().default(now()),
    lastSeenAt: text("last_seen_at").notNull().default(now()),
    requestCount: integer("request_count").notNull().default(1),
  },
  (view) => ({
    recordingAgentViewSessionUnique: uniqueIndex(
      "recording_agent_views_session_unique_idx",
    ).on(view.recordingId, view.agentKey, view.viewSessionId),
  }),
);


export const meetings = table("clips_meetings", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id"),
  title: text("title").notNull().default("Untitled meeting"),
  scheduledStart: text("scheduled_start"),
  scheduledEnd: text("scheduled_end"),
  actualStart: text("actual_start"),
  actualEnd: text("actual_end"),
  endReason: text("end_reason"),
  platform: text("platform", {
    enum: ["zoom", "meet", "teams", "webex", "phone", "adhoc", "other"],
  })
    .notNull()
    .default("adhoc"),
  joinUrl: text("join_url"),
  calendarEventId: text("calendar_event_id"),
  recordingId: text("recording_id"),
  userNotesMd: text("user_notes_md").notNull().default(""),
  transcriptStatus: text("transcript_status", {
    enum: ["idle", "pending", "ready", "failed"],
  })
    .notNull()
    .default("idle"),
  shareTranscript: boolean("share_transcript").notNull().default(false),
  summaryMd: text("summary_md").notNull().default(""),
  bulletsJson: text("bullets_json").notNull().default("[]"),
  actionItemsJson: text("action_items_json").notNull().default("[]"),
  source: text("source", {
    enum: ["calendar", "adhoc", "manual"],
  })
    .notNull()
    .default("adhoc"),
  reminderFiredAt: text("reminder_fired_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  archivedAt: text("archived_at"),
  trashedAt: text("trashed_at"),
  ...ownableColumns(),
});

export const meetingShares = createSharesTable("clips_meeting_shares");

export const meetingParticipants = table("meeting_participants", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  isOrganizer: boolean("is_organizer").notNull().default(false),
  attendedAt: text("attended_at"),
  createdAt: text("created_at").notNull().default(now()),
});

export const meetingActionItems = table("meeting_action_items", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  assigneeEmail: text("assignee_email"),
  text: text("text").notNull(),
  dueDate: text("due_date"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(now()),
});


export const calendarAccounts = table("calendar_accounts", {
  id: text("id").primaryKey(),
  provider: text("provider", {
    enum: ["google", "icloud", "microsoft"],
  }).notNull(),
  externalAccountId: text("external_account_id").notNull(),
  displayName: text("display_name"),
  email: text("email"),
  accessTokenSecretRef: text("access_token_secret_ref"),
  refreshTokenSecretRef: text("refresh_token_secret_ref"),
  lastSyncedAt: text("last_synced_at"),
  lastSyncError: text("last_sync_error"),
  status: text("status", {
    enum: ["connected", "needs-reauth", "disconnected"],
  })
    .notNull()
    .default("connected"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const calendarAccountShares = createSharesTable(
  "calendar_account_shares",
);

export const calendarEvents = table("calendar_events", {
  id: text("id").primaryKey(),
  calendarAccountId: text("calendar_account_id").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  start: text("start").notNull(),
  end: text("end").notNull(),
  organizerEmail: text("organizer_email"),
  joinUrl: text("join_url"),
  location: text("location"),
  attendeesJson: text("attendees_json").notNull().default("[]"),
  meetingId: text("meeting_id"),
  providerUpdatedAt: text("provider_updated_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// framework-shareable resource. It stores only provider metadata and secret

export const slackInstallations = table("slack_installations", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  teamName: text("team_name"),
  enterpriseId: text("enterprise_id"),
  enterpriseName: text("enterprise_name"),
  apiAppId: text("api_app_id"),
  botUserId: text("bot_user_id"),
  botTokenSecretRef: text("bot_token_secret_ref").notNull(),
  secretScope: text("secret_scope", {
    enum: ["user", "org", "workspace"],
  }).notNull(),
  secretScopeId: text("secret_scope_id").notNull(),
  scope: text("scope"),
  installedBySlackUserId: text("installed_by_slack_user_id"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  status: text("status", {
    enum: ["connected", "disconnected", "revoked", "error"],
  })
    .notNull()
    .default("connected"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});


export const dictations = table("clips_dictations", {
  id: text("id").primaryKey(),
  fullText: text("full_text").notNull().default(""),
  cleanedText: text("cleaned_text"),
  durationMs: integer("duration_ms").notNull().default(0),
  audioUrl: text("audio_url"),
  source: text("source", {
    enum: [
      "fn-hold",
      "cmd-shift-space",
      "manual",
      "mobile",
      "other",
      "fn",
      "custom",
    ],
  })
    .notNull()
    .default("fn-hold"),
  targetApp: text("target_app"),
  startedAt: text("started_at").notNull().default(now()),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const dictationShares = createSharesTable("clips_dictation_shares");

export const vocabulary = table("clips_vocabulary", {
  id: text("id").primaryKey(),
  term: text("term").notNull(),
  replacement: text("replacement").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  usesCount: integer("uses_count").notNull().default(1),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const vocabularyShares = createSharesTable("clips_vocabulary_shares");

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
      "access-request",
    ],
  }).notNull(),
  timestampMs: integer("timestamp_ms").notNull().default(0),
  payload: text("payload").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
});

export const transactionalEmailJobs = table(
  "clips_transactional_email_jobs",
  {
    logicalKey: text("logical_key").primaryKey(),
    type: text("type", {
      enum: [
        "first-view",
        "unviewed-reminder",
        "first-agent-view",
        "first-import",
        "monthly-recap",
        "two-clips",
      ],
    }).notNull(),
    state: text("state", {
      enum: [
        "pending",
        "awaiting_ai",
        "ai_dispatched",
        "ready",
        "sending",
        "sent",
        "cancelled",
        "failed",
      ],
    }).notNull(),
    recipient: text("recipient").notNull(),
    recordingIdsJson: text("recording_ids_json").notNull(),
    shareId: text("share_id"),
    requestedBy: text("requested_by"),
    month: text("month"),
    generatedSummary: text("generated_summary"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    aiDispatchedAt: text("ai_dispatched_at"),
    aiClaimedBy: text("ai_claimed_by"),
    readyAt: text("ready_at"),
    sendingAt: text("sending_at"),
    sentAt: text("sent_at"),
    cancelledAt: text("cancelled_at"),
    failedAt: text("failed_at"),
    lastError: text("last_error"),
    leaseUntil: text("lease_until"),
    leaseToken: text("lease_token"),
  },
  (job) => ({
    transactionalEmailJobsStateCreatedIndex: index(
      "clips_transactional_email_jobs_state_created_idx",
    ).on(job.state, job.createdAt),
  }),
);

export const transactionalEmailConfigs = table(
  "clips_transactional_email_configs",
  {
    id: text("id").primaryKey(),
    configJson: text("config_json").notNull(),
  },
);
