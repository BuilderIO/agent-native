import {
  index,
  integer,
  now,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";

export const triageItems = table(
  "factory_items",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url"),
    title: text("title").notNull(),
    summary: text("summary"),
    status: text("status").notNull().default("received"),
    risk: text("risk").notNull().default("unknown"),
    channelId: text("channel_id"),
    threadTs: text("thread_ts"),
    repository: text("repository"),
    pullRequestNumber: integer("pull_request_number"),
    headSha: text("head_sha"),
    coverage: text("coverage").notNull().default("unknown"),
    dedupeKey: text("dedupe_key").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
  },
  (item) => ({
    orgDedupeUnique: uniqueIndex("factory_items_org_dedupe_idx").on(
      item.orgId,
      item.dedupeKey,
    ),
    orgStatusIdx: index("factory_items_org_status_idx").on(
      item.orgId,
      item.status,
      item.updatedAt,
    ),
  }),
);

export const triageRules = table("factory_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  promptText: text("prompt_text").notNull(),
  mode: text("mode").notNull().default("shadow"),
  enabled: integer("enabled").notNull().default(1),
  guardsJson: text("guards_json").notNull().default("{}"),
  promptVersion: integer("prompt_version").notNull().default(1),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

export const triageDecisions = table("factory_decisions", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  ruleId: text("rule_id"),
  mode: text("mode").notNull().default("shadow"),
  outcome: text("outcome").notNull(),
  reason: text("reason").notNull(),
  guardResultsJson: text("guard_results_json").notNull().default("[]"),
  model: text("model"),
  promptVersion: integer("prompt_version"),
  createdAt: text("created_at").notNull().default(now()),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

export const triageRuns = table("factory_runs", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  source: text("source").notNull(),
  provider: text("provider"),
  providerTaskId: text("provider_task_id"),
  dedupeKey: text("dedupe_key"),
  approvalEmail: text("approval_email"),
  status: text("status").notNull().default("received"),
  progressLogJson: text("progress_log_json").notNull().default("[]"),
  dispatchAttempts: integer("dispatch_attempts").notNull().default(0),
  needsContinuation: integer("needs_continuation").notNull().default(0),
  startedAt: text("started_at").notNull().default(now()),
  heartbeatAt: text("heartbeat_at"),
  completedAt: text("completed_at"),
  error: text("error"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

export const triageFeedback = table("factory_feedback", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id").notNull(),
  verdict: text("verdict").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull().default(now()),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

export const triageConfig = table("factory_config", {
  id: text("id").primaryKey(),
  slackWorkspace: text("slack_workspace").notNull().default("primary"),
  slackChannelId: text("slack_channel_id"),
  slackChannelName: text("slack_channel_name"),
  pollingEnabled: integer("polling_enabled").notNull().default(0),
  lastSlackTs: text("last_slack_ts"),
  slackHistoryCursor: text("slack_history_cursor"),
  repository: text("repository"),
  githubPollingEnabled: integer("github_polling_enabled").notNull().default(0),
  sentryPollingEnabled: integer("sentry_polling_enabled").notNull().default(0),
  sentryOrgSlug: text("sentry_org_slug"),
  sentryProjectSlug: text("sentry_project_slug"),
  sentryEnvironment: text("sentry_environment"),
  lastSentrySeenAt: text("last_sentry_seen_at"),
  automationFailureAlertsEnabled: integer("automation_failure_alerts_enabled")
    .notNull()
    .default(1),
  automationFailureAlertEmail: text("automation_failure_alert_email"),
  lastAutomationFailureAlertKey: text("last_automation_failure_alert_key"),
  lastAutomationFailureAlertAt: text("last_automation_failure_alert_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

export const factoryDefinitions = table(
  "factory_definitions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    prompt: text("prompt").notNull().default(""),
    graphVersion: integer("graph_version").notNull().default(1),
    graphJson: text("graph_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
  },
  (factory) => ({
    orgUpdatedIdx: index("factory_definitions_org_updated_idx").on(
      factory.orgId,
      factory.updatedAt,
    ),
  }),
);

export const factoryGraphVersions = table(
  "factory_graph_versions",
  {
    id: text("id").primaryKey(),
    factoryId: text("factory_id").notNull(),
    version: integer("version").notNull(),
    graphJson: text("graph_json").notNull(),
    source: text("source").notNull().default("manual"),
    changeSummary: text("change_summary").notNull().default(""),
    createdAt: text("created_at").notNull().default(now()),
    createdBy: text("created_by").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
  },
  (version) => ({
    factoryVersionUnique: uniqueIndex("factory_graph_versions_unique_idx").on(
      version.orgId,
      version.factoryId,
      version.version,
    ),
    factoryCreatedIdx: index("factory_graph_versions_created_idx").on(
      version.orgId,
      version.factoryId,
      version.createdAt,
    ),
  }),
);

export const factoryComments = table(
  "factory_comments",
  {
    id: text("id").primaryKey(),
    factoryId: text("factory_id").notNull(),
    graphVersion: integer("graph_version").notNull(),
    targetType: text("target_type").notNull().default("canvas"),
    targetId: text("target_id"),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
  },
  (comment) => ({
    factoryCreatedIdx: index("factory_comments_created_idx").on(
      comment.orgId,
      comment.factoryId,
      comment.createdAt,
    ),
  }),
);
