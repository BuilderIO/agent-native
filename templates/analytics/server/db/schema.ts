import {
  table,
  text,
  integer,
  now,
  index,
  ownableColumns,
  createSharesTable,
  uniqueIndex,
} from "@agent-native/core/db/schema";

/**
 * Dashboards table — covers both Explorer and SQL dashboards. The
 * distinction lives in `kind` and the shape of the `config` JSON blob.
 * Previously stored in the settings KV store under
 * `u:<email>:dashboard-{id}` / `u:<email>:sql-dashboard-{id}` /
 * `o:<orgId>:sql-dashboard-{id}`. Those keys are read as a fallback
 * during lazy migration (see server/lib/dashboards-store.ts) and the
 * legacy rows can be removed once the team is sure everyone's migrated.
 */
export const dashboards = table("dashboards", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["explorer", "sql"] }).notNull(),
  title: text("title").notNull().default("Untitled"),
  /** Full dashboard config (SqlDashboardConfig or Explorer state) as JSON. */
  config: text("config").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  /** Archive timestamp. Null = active. Archived rows are hidden from
   *  default list responses but remain accessible by id and can be restored. */
  archivedAt: text("archived_at"),
  /** Hidden dashboards are omitted from default navigation but remain openable. */
  hiddenAt: text("hidden_at"),
  hiddenBy: text("hidden_by"),
  ...ownableColumns(),
});

export const dashboardShares = createSharesTable("dashboard_shares");

/**
 * Saved filter views per dashboard. Lives alongside the parent and is
 * governed by the parent's sharing (no separate share rows).
 */
export const dashboardViews = table("dashboard_views", {
  id: text("id").primaryKey(),
  dashboardId: text("dashboard_id").notNull(),
  name: text("name").notNull(),
  /** Filter params as JSON (Record<string, string>). */
  filters: text("filters").notNull().default("{}"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(now()),
});

/**
 * Scheduled email snapshots for SQL dashboards. Each row belongs to the user
 * who created the subscription; dashboard access is re-checked before every
 * send so revoking dashboard access also stops future deliveries.
 */
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
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    lastStatus: text("last_status", {
      enum: ["success", "error", "running"],
    }),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
);

/**
 * Ad-hoc analyses. Previously stored in the settings KV store under
 * `adhoc-analysis-{id}`. Those keys are read as a fallback during lazy
 * migration. See server/lib/analyses-store.ts.
 */
export const analyses = table("analyses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Original user question that triggered the analysis. */
  question: text("question").notNull().default(""),
  /** Step-by-step re-run instructions. */
  instructions: text("instructions").notNull().default(""),
  /** Data sources referenced, as JSON array of strings. */
  dataSources: text("data_sources").notNull().default("[]"),
  /** Full findings in Markdown. */
  resultMarkdown: text("result_markdown").notNull().default(""),
  /** Optional structured result data, as JSON. */
  resultData: text("result_data"),
  author: text("author"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  /** Hidden analyses are omitted from default navigation but remain openable. */
  hiddenAt: text("hidden_at"),
  hiddenBy: text("hidden_by"),
  ...ownableColumns(),
});

export const analysisShares = createSharesTable("analysis_shares");

/**
 * Curated "Strategic Accounts" list — the source of truth for the migrated
 * fusion-analytics Strategic Accounts overview. The (sensitive) account names
 * live ONLY in this org-scoped table and the dashboard config row, never in
 * source or git. Both surfaces read from it: the extension reads it live, and
 * the SQL dashboard's `accounts` variable is projected from it.
 *
 * `deploymentStatus` and `notes` are editable manual fields (the source kept
 * these in localStorage); everything else is the curated roster. Metrics are
 * always queried live from BigQuery, never stored here.
 */
export const strategicAccounts = table("strategic_accounts", {
  id: text("id").primaryKey(),
  /** HubSpot company name — the join key against warehouse tables. */
  companyName: text("company_name").notNull(),
  /** Optional HubSpot company id when known. */
  companyId: text("company_id"),
  /** Editable deployment-status badge (e.g. "Production", "Pilot"). */
  deploymentStatus: text("deployment_status").notNull().default(""),
  /** Editable free-text note. */
  notes: text("notes").notNull().default(""),
  /** Manual ordering for the grid. */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const strategicAccountShares = createSharesTable(
  "strategic_account_shares",
);

/**
 * Curated "Strategic Account Coverage" contacts — the source of truth for the
 * migrated fusion-analytics coverage child dashboard. Each row is one
 * stakeholder for an account in a given role (champion / enabler / exec
 * sponsor). Sensitive contact details (names, emails) live ONLY in this
 * org-scoped table, never in source/git. The dashboard reads it via the `app`
 * panel source.
 */
export const strategicAccountContacts = table("strategic_account_contacts", {
  id: text("id").primaryKey(),
  /** Company name — the join key against the curated roster. */
  companyName: text("company_name").notNull(),
  /** Coverage role: "champion" | "enabler" | "exec_sponsor". */
  role: text("role").notNull().default("champion"),
  contactName: text("contact_name").notNull().default(""),
  title: text("title").notNull().default(""),
  email: text("email").notNull().default(""),
  /** Confidence in this assignment: "high" | "medium" | "low". */
  confidence: text("confidence").notNull().default("medium"),
  /** Why this person fits the role. */
  rationale: text("rationale").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const strategicAccountContactShares = createSharesTable(
  "strategic_account_contact_shares",
);

/**
 * Curated "Implementation Blockers" — the source of truth for the migrated
 * fusion-analytics blockers child dashboard. Each row is one blocker affecting
 * an account. Customer-specific details live ONLY in this org-scoped table,
 * never in source/git. The dashboard reads it via the `app` panel source.
 */
export const implementationBlockers = table("implementation_blockers", {
  id: text("id").primaryKey(),
  /** Company name affected by the blocker. */
  companyName: text("company_name").notNull(),
  /** Blocker category (e.g. "git-integration", "security-vpn-network"). */
  blockerType: text("blocker_type").notNull().default(""),
  /** Lifecycle status: "active" | "monitoring" | "resolved". */
  status: text("status").notNull().default("active"),
  /** Short headline for the blocker. */
  summary: text("summary").notNull().default(""),
  /** Longer free-text detail. */
  details: text("details").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const implementationBlockerShares = createSharesTable(
  "implementation_blocker_shares",
);

/**
 * BigQuery result cache (pre-existing — moved here from db plugin so a
 * single drizzle schema covers the template).
 */
export const bigqueryCache = table("bigquery_cache", {
  key: text("key").primaryKey(),
  sql: text("sql").notNull(),
  result: text("result").notNull(),
  bytesProcessed: integer("bytes_processed").notNull().default(0),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

/**
 * Public write keys for the first-party analytics ingestion endpoint.
 * The key is intentionally public/write-only: it can create events for the
 * owning user/org but grants no read or admin access.
 */
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

/**
 * First-party product analytics events recorded via /track.
 * Common dimensions are mirrored as columns so dashboards can group/filter
 * without dialect-specific JSON operators.
 */
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

/**
 * Session replay summaries recorded through the first-party analytics replay
 * endpoint. Raw replay chunks live in session_replay_chunks and are only read
 * through scoped replay helpers, not first-party dashboard SQL.
 */
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
