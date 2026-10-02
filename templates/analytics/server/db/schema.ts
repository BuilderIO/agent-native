import {
  table,
  text,
  integer,
  now,
  index,
  ownableColumns,
  createSharesTable,
  real,
  uniqueIndex,
} from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

export * from "./schema-monitoring.js";
export * from "./schema-errors.js";

export const dashboards = table("dashboards", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["explorer", "sql"] }).notNull(),
  title: text("title").notNull().default("Untitled"),
  config: text("config").notNull(),
  certification: text("certification"),
  createdAt: text("created_at").notNull().default(now()),
  createdBy: text("created_by"),
  updatedAt: text("updated_at").notNull().default(now()),
  archivedAt: text("archived_at"),
  hiddenAt: text("hidden_at"),
  hiddenBy: text("hidden_by"),
  folderId: text("folder_id"),
  updatedBy: text("updated_by"),
  ...ownableColumns(),
});

export const dashboardNameLocks = table("dashboard_name_locks", {
  nameKey: text("name_key").primaryKey(),
  createdAt: text("created_at").notNull().default(now()),
});

export const dashboardShares = createSharesTable("dashboard_shares");

export const dashboardFolders = table("dashboard_folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope", { enum: ["personal", "shared"] }).notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const dashboardFolderShares = createSharesTable(
  "dashboard_folder_shares",
);

export const dashboardRevisions = table(
  "dashboard_revisions",
  {
    id: text("id").primaryKey(),
    dashboardId: text("dashboard_id").notNull(),
    kind: text("kind", { enum: ["explorer", "sql"] }).notNull(),
    title: text("title").notNull(),
    config: text("config").notNull(),
    createdAt: text("created_at").notNull().default(now()),
    createdBy: text("created_by"),
    chatContext: text("chat_context"),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (t) => ({
    dashboardCreatedIdx: index("dashboard_revisions_dashboard_created_idx").on(
      t.dashboardId,
      t.createdAt,
    ),
    orgDashboardIdx: index("dashboard_revisions_org_dashboard_idx").on(
      t.orgId,
      t.dashboardId,
    ),
  }),
);

export const dashboardViews = table("dashboard_views", {
  id: text("id").primaryKey(),
  dashboardId: text("dashboard_id").notNull(),
  name: text("name").notNull(),
  filters: text("filters").notNull().default("{}"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(now()),
});

export const dashboardReportSubscriptions = table(
  "dashboard_report_subscriptions",
  {
    id: text("id").primaryKey(),
    dashboardId: text("dashboard_id").notNull(),
    name: text("name").notNull(),
    recipients: text("recipients").notNull().default("[]"),
    filters: text("filters").notNull().default("{}"),
    frequency: text("frequency", { enum: ["daily"] })
      .notNull()
      .default("daily"),
    timeOfDay: text("time_of_day").notNull().default("09:00"),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    lastStatus: text("last_status", {
      enum: ["success", "error", "running"],
    }),
    lastError: text("last_error"),
    lastCaptureAt: text("last_capture_at"),
    lastCaptureMode: text("last_capture_mode", {
      enum: ["full", "partial", "none"],
    }),
    lastCaptureError: text("last_capture_error"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
);

export const analyses = table("analyses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  question: text("question").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  dataSources: text("data_sources").notNull().default("[]"),
  resultMarkdown: text("result_markdown").notNull().default(""),
  resultData: text("result_data"),
  author: text("author"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  hiddenAt: text("hidden_at"),
  hiddenBy: text("hidden_by"),
  ...ownableColumns(),
});

export const analysisRevisions = table(
  "analysis_revisions",
  {
    id: text("id").primaryKey(),
    analysisId: text("analysis_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    question: text("question").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    dataSources: text("data_sources").notNull().default("[]"),
    resultMarkdown: text("result_markdown").notNull().default(""),
    resultData: text("result_data"),
    createdAt: text("created_at").notNull().default(now()),
    createdBy: text("created_by"),
    chatContext: text("chat_context"),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (t) => ({
    analysisCreatedIdx: index("analysis_revisions_analysis_created_idx").on(
      t.analysisId,
      t.createdAt,
    ),
  }),
);

export const analysisShares = createSharesTable("analysis_shares");

export const bigqueryCache = table("bigquery_cache", {
  key: text("key").primaryKey(),
  sql: text("sql").notNull(),
  result: text("result").notNull(),
  bytesProcessed: integer("bytes_processed").notNull().default(0),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const firstPartyAnalyticsCache = table("first_party_analytics_cache", {
  key: text("key").primaryKey(),
  sql: text("sql").notNull(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const analyticsPublicKeys = table("analytics_public_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull(),
  publicKeyPrefix: text("public_key_prefix").notNull(),
  replayAllowedOrigins: text("replay_allowed_origins").notNull().default("[]"),
  replayMaxBytesPerDay: integer("replay_max_bytes_per_day")
    .notNull()
    .default(100 * 1024 * 1024),
  replayMaxRequestsPerMinute: integer("replay_max_requests_per_minute")
    .notNull()
    .default(120),
  createdAt: text("created_at").notNull().default(now()),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  orgId: text("org_id"),
});

export const analyticsEvents = table("analytics_events", {
  id: text("id").primaryKey(),
  publicKeyId: text("public_key_id").notNull(),
  eventName: text("event_name").notNull(),
  userId: text("user_id"),
  anonymousId: text("anonymous_id"),
  userKey: text("user_key"),
  sessionId: text("session_id"),
  timestamp: text("timestamp").notNull(),
  eventDate: text("event_date"),
  receivedAt: text("received_at").notNull().default(now()),
  url: text("url"),
  path: text("path"),
  hostname: text("hostname"),
  referrer: text("referrer"),
  app: text("app"),
  template: text("template"),
  signedIn: text("signed_in"),
  properties: text("properties").notNull().default("{}"),
  context: text("context").notNull().default("{}"),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  orgId: text("org_id"),
});

export const analyticsBigQueryDeliveryQueue = table(
  "analytics_bigquery_delivery_queue",
  {
    eventId: text("event_id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    tableRef: text("table_ref"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull().default(now()),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    deliveredAt: text("delivered_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (t) => ({
    dueIdx: index("analytics_bigquery_delivery_queue_due_idx").on(
      t.deliveredAt,
      t.nextAttemptAt,
      t.leaseExpiresAt,
      t.createdAt,
    ),
    scopeIdx: index("analytics_bigquery_delivery_queue_scope_idx").on(
      t.orgId,
      t.ownerEmail,
      t.createdAt,
    ),
  }),
);

export const analyticsEventDailyRollups = table(
  "analytics_event_daily_rollups",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    eventDate: text("event_date").notNull(),
    eventName: text("event_name").notNull(),
    app: text("app").notNull().default(""),
    template: text("template").notNull().default(""),
    eventCount: integer("event_count").notNull().default(0),
  },
);

// Per-session event index, written at ingest for every storage sink so session
// filters and the event catalog never read the event store per view.
export const analyticsSessionEvents = table(
  "analytics_session_events",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    sessionId: text("session_id").notNull(),
    eventName: text("event_name").notNull(),
    app: text("app").notNull().default(""),
    eventCount: integer("event_count").notNull().default(0),
    firstAt: text("first_at").notNull(),
    lastAt: text("last_at").notNull(),
  },
  (t) => ({
    sessionEventUnique: uniqueIndex("analytics_session_events_key_idx").on(
      t.tenantKey,
      t.sessionId,
      t.eventName,
    ),
    tenantLastAtIdx: index("analytics_session_events_tenant_last_at_idx").on(
      t.tenantKey,
      t.lastAt,
    ),
  }),
);

export const analyticsEventCatalogDaily = table(
  "analytics_event_catalog_daily",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    eventDate: text("event_date").notNull(),
    eventName: text("event_name").notNull(),
    app: text("app").notNull().default(""),
    eventCount: integer("event_count").notNull().default(0),
    lastSeenAt: text("last_seen_at").notNull(),
    propertyKeys: text("property_keys").notNull().default("[]"),
  },
  (t) => ({
    catalogDayUnique: uniqueIndex("analytics_event_catalog_daily_key_idx").on(
      t.tenantKey,
      t.eventDate,
      t.eventName,
      t.app,
    ),
  }),
);

// Each event's latest sighting per app, so the catalog never scans daily
// history for last-seen times.
export const analyticsEventCatalogLatest = table(
  "analytics_event_catalog_latest",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    eventName: text("event_name").notNull(),
    app: text("app").notNull().default(""),
    lastSeenAt: text("last_seen_at").notNull(),
    propertyKeys: text("property_keys").notNull().default("[]"),
  },
  (t) => ({
    catalogLatestUnique: uniqueIndex(
      "analytics_event_catalog_latest_key_idx",
    ).on(t.tenantKey, t.eventName, t.app),
  }),
);

// Sessions whose index write failed. A later batch can still index them, so
// "didn't" filters exclude them rather than read missing rows as absence.
export const analyticsSessionEventGaps = table(
  "analytics_session_event_gaps",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    sessionId: text("session_id").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => ({
    sessionGapUnique: uniqueIndex("analytics_session_event_gaps_key_idx").on(
      t.tenantKey,
      t.sessionId,
    ),
  }),
);

// When each tenant's session event index started. Sessions that began earlier
// have incomplete event coverage, so event filters exclude them.
export const analyticsSessionEventCoverage = table(
  "analytics_session_event_coverage",
  {
    tenantKey: text("tenant_key").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    startedAt: text("started_at").notNull(),
  },
);

// Weighted histogram buckets of page-view vitals and request durations, per
// day, app, and route template. Buckets are positional within a histogram
// version; see shared/session-performance.ts.
export const analyticsRoutePerformanceDaily = table(
  "analytics_route_performance_daily",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    eventDate: text("event_date").notNull(),
    app: text("app").notNull().default(""),
    route: text("route").notNull(),
    metric: text("metric").notNull(),
    histogramVersion: integer("histogram_version").notNull().default(1),
    bucket: integer("bucket").notNull(),
    weight: real("weight").notNull().default(0),
  },
  (t) => ({
    routePerformanceUnique: uniqueIndex(
      "analytics_route_performance_daily_key_idx",
    ).on(
      t.tenantKey,
      t.eventDate,
      t.app,
      t.route,
      t.metric,
      t.histogramVersion,
      t.bucket,
    ),
  }),
);

// Each session's worst measured page view and its slow requests. Null metrics
// were never measured, which is not the same as fast.
export const analyticsSessionPerformance = table(
  "analytics_session_performance",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    sessionId: text("session_id").notNull(),
    app: text("app").notNull().default(""),
    pageViews: integer("page_views").notNull().default(0),
    maxTtfbMs: real("max_ttfb_ms"),
    maxLcpMs: real("max_lcp_ms"),
    maxInpMs: real("max_inp_ms"),
    maxCls: real("max_cls"),
    slowRequests: integer("slow_requests").notNull().default(0),
    maxRequestMs: real("max_request_ms"),
    firstAt: text("first_at").notNull(),
    lastAt: text("last_at").notNull(),
  },
  (t) => ({
    sessionPerformanceUnique: uniqueIndex(
      "analytics_session_performance_key_idx",
    ).on(t.tenantKey, t.sessionId),
    tenantLastAtIdx: index(
      "analytics_session_performance_tenant_last_at_idx",
    ).on(t.tenantKey, t.lastAt),
  }),
);

// Days, and sessions within them, whose performance aggregates failed to
// record some events. An empty session id marks the day's route aggregates.
export const analyticsPerformanceGaps = table(
  "analytics_performance_gaps",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    eventDate: text("event_date").notNull(),
    sessionId: text("session_id").notNull().default(""),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => ({
    performanceGapUnique: uniqueIndex("analytics_performance_gaps_key_idx").on(
      t.tenantKey,
      t.eventDate,
      t.sessionId,
    ),
  }),
);

// When each tenant's performance aggregates began.
export const analyticsPerformanceCoverage = table(
  "analytics_performance_coverage",
  {
    tenantKey: text("tenant_key").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    startedAt: text("started_at").notNull(),
  },
);

export const analyticsUserDays = table("analytics_user_days", {
  id: text("id").primaryKey(),
  tenantKey: text("tenant_key").notNull(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  eventDate: text("event_date").notNull(),
  userKey: text("user_key").notNull(),
});

export const analyticsEventVolumeUsage = table(
  "analytics_event_volume_usage",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    windowStart: text("window_start").notNull(),
    eventCount: integer("event_count").notNull().default(0),
    eventLimit: integer("event_limit").notNull(),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (t) => ({
    tenantWindowUnique: uniqueIndex(
      "analytics_event_volume_usage_tenant_window_idx",
    ).on(t.tenantKey, t.windowStart),
    updatedAtIdx: index("analytics_event_volume_usage_updated_at_idx").on(
      t.updatedAt,
    ),
  }),
);

export const analyticsQueryPressureDaily = table(
  "analytics_query_pressure_daily",
  {
    id: text("id").primaryKey(),
    tenantKey: text("tenant_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    eventDate: text("event_date").notNull(),
    queryClass: text("query_class").notNull(),
    slowQueryCount: integer("slow_query_count").notNull().default(0),
    timeoutCount: integer("timeout_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    totalDurationMs: integer("total_duration_ms").notNull().default(0),
    maxDurationMs: integer("max_duration_ms").notNull().default(0),
    lastSeenAt: text("last_seen_at").notNull(),
  },
);

export const analyticsAlertRules = table("analytics_alert_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  eventName: text("event_name"),
  filters: text("filters").notNull().default("[]"),
  thresholdMode: text("threshold_mode", {
    enum: ["event_count", "distinct_count"],
  })
    .notNull()
    .default("event_count"),
  distinctBy: text("distinct_by"),
  threshold: integer("threshold").notNull().default(1),
  windowMinutes: integer("window_minutes").notNull().default(10),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(30),
  severity: text("severity", { enum: ["warning", "critical"] })
    .notNull()
    .default("warning"),
  channels: text("channels").notNull().default('["inbox"]'),
  emailRecipients: text("email_recipients").notNull().default("[]"),
  slackWebhookUrl: text("slack_webhook_url"),
  webhookUrl: text("webhook_url"),
  enabled: boolean("enabled").notNull().default(true),
  lastEvaluatedAt: text("last_evaluated_at"),
  lastTriggeredAt: text("last_triggered_at"),
  lastStatus: text("last_status", {
    enum: ["ok", "triggered", "cooldown", "error", "running"],
  }),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  orgId: text("org_id"),
});

export const analyticsAlertIncidents = table("analytics_alert_incidents", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id").notNull(),
  triggeredAt: text("triggered_at").notNull(),
  windowStart: text("window_start").notNull(),
  windowEnd: text("window_end").notNull(),
  threshold: integer("threshold").notNull(),
  observedValue: integer("observed_value").notNull(),
  eventCount: integer("event_count").notNull(),
  severity: text("severity", { enum: ["warning", "critical"] }).notNull(),
  channels: text("channels").notNull().default("[]"),
  sampleEvents: text("sample_events").notNull().default("[]"),
  notificationId: text("notification_id"),
  createdAt: text("created_at").notNull().default(now()),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  orgId: text("org_id"),
});

export const analyticsDbAdminConnections = table(
  "analytics_db_admin_connections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    appId: text("app_id"),
    appUrl: text("app_url"),
    databaseUrlSecretKey: text("database_url_secret_key").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    orgId: text("org_id").notNull(),
  },
  (connection) => ({
    orgUpdatedIdx: index("analytics_db_admin_connections_org_updated_idx").on(
      connection.orgId,
      connection.updatedAt,
    ),
  }),
);

export const sessionRecordings = table("session_recordings", {
  id: text("id").primaryKey(),
  publicKeyId: text("public_key_id").notNull(),
  clientRecordingId: text("client_recording_id").notNull(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id"),
  anonymousId: text("anonymous_id"),
  userKey: text("user_key"),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  durationMs: integer("duration_ms"),
  chunkCount: integer("chunk_count").notNull().default(0),
  eventCount: integer("event_count").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  pageCount: integer("page_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  networkErrorCount: integer("network_error_count").notNull().default(0),
  rageClickCount: integer("rage_click_count").notNull().default(0),
  privacyMode: text("privacy_mode").notNull().default("unknown"),
  firstUrl: text("first_url"),
  lastUrl: text("last_url"),
  path: text("path"),
  hostname: text("hostname"),
  referrer: text("referrer"),
  app: text("app"),
  template: text("template"),
  status: text("status", { enum: ["active", "completed"] })
    .notNull()
    .default("active"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  lastIngestedAt: text("last_ingested_at"),
  ...ownableColumns(),
});

export const sessionRecordingShares = createSharesTable(
  "session_recording_shares",
);

export const sessionReplayChunks = table(
  "session_replay_chunks",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id").notNull(),
    seq: integer("seq").notNull(),
    checksum: text("checksum").notNull(),
    byteLength: integer("byte_length").notNull().default(0),
    eventCount: integer("event_count").notNull().default(0),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    storageKind: text("storage_kind", { enum: ["inline", "blob"] }).notNull(),
    storageRef: text("storage_ref"),
    inlineData: text("inline_data"),
    createdAt: text("created_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (chunk) => ({
    recordingSeqUnique: uniqueIndex(
      "session_replay_chunks_recording_seq_idx",
    ).on(chunk.recordingId, chunk.seq),
  }),
);

export const sessionReplayIngests = table(
  "session_replay_ingests",
  {
    id: text("id").primaryKey(),
    publicKeyId: text("public_key_id").notNull(),
    recordingId: text("recording_id").notNull(),
    byteLength: integer("byte_length").notNull().default(0),
    createdAt: text("created_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (ingest) => ({
    publicKeyCreatedAtIdx: index(
      "session_replay_ingests_public_key_created_at_idx",
    ).on(ingest.publicKeyId, ingest.createdAt),
    recordingIdx: index("session_replay_ingests_recording_idx").on(
      ingest.recordingId,
    ),
  }),
);
