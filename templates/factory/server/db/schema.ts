import {
  index,
  integer,
  now,
  sql,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";
import { primaryKey } from "drizzle-orm/pg-core";

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
    confidence: text("confidence").notNull().default("unknown"),
    channelId: text("channel_id"),
    threadTs: text("thread_ts"),
    repository: text("repository"),
    pullRequestNumber: integer("pull_request_number"),
    headSha: text("head_sha"),
    coverage: text("coverage").notNull().default("unknown"),
    dedupeKey: text("dedupe_key").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    // The provider's own fields for an item a workflow brought in. Bounded to
    // 8 KB by `serializeItemPayload`, the only writer.
    payloadJson: text("payload_json").notNull().default("{}"),
    // Handle to a large body in blob storage; the body itself never lands here.
    textRef: text("text_ref"),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    factoryId: text("factory_id"),
  },
  (item) => ({
    orgFactoryDedupeUnique: uniqueIndex(
      "factory_items_org_factory_dedupe_idx",
    ).on(item.orgId, item.factoryId, item.dedupeKey),
    orgStatusIdx: index("factory_items_org_status_idx").on(
      item.orgId,
      item.status,
      item.updatedAt,
    ),
    orgFactoryStatusIdx: index("factory_items_org_factory_status_idx").on(
      item.orgId,
      item.factoryId,
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
  factoryId: text("factory_id"),
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
  factoryId: text("factory_id"),
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
  factoryId: text("factory_id"),
});

export const triageFeedback = table("factory_feedback", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id").notNull(),
  verdict: text("verdict").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull().default(now()),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  factoryId: text("factory_id"),
});

export const triageConfig = table("factory_config", {
  id: text("id").primaryKey(),
  slackWorkspace: text("slack_workspace").notNull().default("primary"),
  slackChannelId: text("slack_channel_id"),
  slackChannelName: text("slack_channel_name"),
  builderSlackUserId: text("builder_slack_user_id"),
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
  factoryId: text("factory_id"),
});

export const factoryAuditEvents = table(
  "factory_audit_events",
  {
    id: text("id").primaryKey(),
    automationRunId: text("automation_run_id"),
    automationThreadId: text("automation_thread_id"),
    automationName: text("automation_name"),
    itemId: text("item_id"),
    source: text("source"),
    sourceUrl: text("source_url"),
    action: text("action").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    summary: text("summary").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    factoryId: text("factory_id"),
  },
  (event) => ({
    orgCreatedIdx: index("factory_audit_events_org_created_idx").on(
      event.orgId,
      event.createdAt,
    ),
    orgFactoryCreatedIdx: index(
      "factory_audit_events_org_factory_created_idx",
    ).on(event.orgId, event.factoryId, event.createdAt),
    runCreatedIdx: index("factory_audit_events_run_created_idx").on(
      event.orgId,
      event.automationRunId,
      event.createdAt,
    ),
    itemCreatedIdx: index("factory_audit_events_item_created_idx").on(
      event.orgId,
      event.itemId,
      event.createdAt,
    ),
  }),
);

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
    chatContext: text("chat_context"),
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

export const factoryAutomationVersions = table(
  "factory_automation_versions",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id").notNull(),
    factoryId: text("factory_id").notNull(),
    version: integer("version").notNull(),
    rawContent: text("raw_content").notNull(),
    displayName: text("display_name"),
    source: text("source").notNull().default("save"),
    summary: text("summary").notNull().default(""),
    createdAt: text("created_at").notNull().default(now()),
    createdBy: text("created_by").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
  },
  (version) => ({
    automationVersionUnique: uniqueIndex(
      "factory_automation_versions_unique_idx",
    ).on(version.orgId, version.automationId, version.version),
    automationCreatedIdx: index("factory_automation_versions_created_idx").on(
      version.orgId,
      version.automationId,
      version.createdAt,
    ),
  }),
);

export const factoryPollCursors = table(
  "factory_poll_cursors",
  {
    id: text("id").primaryKey(),
    factoryId: text("factory_id").notNull(),
    source: text("source").notNull(),
    destinationKey: text("destination_key").notNull(),
    lastSlackTs: text("last_slack_ts"),
    slackHistoryCursor: text("slack_history_cursor"),
    lastSentrySeenAt: text("last_sentry_seen_at"),
    // Unused since the PR babysit job was retired; kept because migrations
    // never drop columns.
    babysitQueueCursor: text("babysit_queue_cursor"),
    // One opaque cursor for a workflow source node: `source` is `workflow` and
    // `destination_key` is `<workflowId>:<nodeId>`.
    cursorValue: text("cursor_value"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
  },
  (cursor) => ({
    orgFactorySourceDestIdx: uniqueIndex(
      "factory_poll_cursors_org_factory_source_dest_idx",
    ).on(cursor.orgId, cursor.factoryId, cursor.source, cursor.destinationKey),
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

// Workflow engine storage. Every table carries org_id and factory_id so reads
// and deletes scope the same way as the rest of Factory. JSON columns hold
// bounded values only; large bodies live in blob storage.

export const factoryWorkflows = table(
  "factory_workflows",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    factoryId: text("factory_id").notNull(),
    automationId: text("automation_id"),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    enabled: integer("enabled").notNull().default(0),
    lastCleanDryRunVersion: integer("last_clean_dry_run_version"),
    lastTriggerAt: text("last_trigger_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ownerEmail: text("owner_email").notNull(),
  },
  (workflow) => ({
    automationUnique: uniqueIndex("factory_workflows_automation_idx").on(
      workflow.orgId,
      workflow.factoryId,
      workflow.automationId,
    ),
    factoryUpdatedIdx: index("factory_workflows_factory_updated_idx").on(
      workflow.orgId,
      workflow.factoryId,
      workflow.updatedAt,
    ),
  }),
);

export const factoryWorkflowVersions = table(
  "factory_workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    orgId: text("org_id").notNull(),
    factoryId: text("factory_id").notNull(),
    version: integer("version").notNull(),
    graphJson: text("graph_json").notNull(),
    source: text("source").notNull().default("save"),
    summary: text("summary").notNull().default(""),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (version) => ({
    workflowVersionUnique: uniqueIndex(
      "factory_workflow_versions_unique_idx",
    ).on(version.workflowId, version.version),
  }),
);

export const factoryWorkflowRuns = table(
  "factory_workflow_runs",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    orgId: text("org_id").notNull(),
    factoryId: text("factory_id").notNull(),
    graphVersion: integer("graph_version").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    tickKey: text("tick_key").notNull(),
    // Null only on a row written before these columns existed; a reader
    // treats that as unreadable, not as a default.
    triggerKind: text("trigger_kind"),
    startedBy: text("started_by"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    countsJson: text("counts_json").notNull().default("{}"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    historyRowId: text("history_row_id"),
  },
  (run) => ({
    tickKeyUnique: uniqueIndex("factory_workflow_runs_tick_key_idx").on(
      run.workflowId,
      run.tickKey,
    ),
    startedIdx: index("factory_workflow_runs_started_idx").on(
      run.workflowId,
      run.startedAt,
    ),
    factoryStartedIdx: index("factory_workflow_runs_factory_started_idx").on(
      run.orgId,
      run.factoryId,
      run.startedAt,
      run.id,
    ),
  }),
);

export const factoryWorkflowSteps = table(
  "factory_workflow_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    nodeId: text("node_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    orgId: text("org_id").notNull(),
    factoryId: text("factory_id").notNull(),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    portsJson: text("ports_json").notNull().default("{}"),
    fieldsJson: text("fields_json"),
    totalAvailable: integer("total_available"),
    inputTruncated: integer("input_truncated"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    receiptKeysJson: text("receipt_keys_json"),
    agentThreadId: text("agent_thread_id"),
  },
  (step) => ({
    runNodeUnique: uniqueIndex("factory_workflow_steps_run_node_idx").on(
      step.runId,
      step.nodeId,
    ),
    nodeStartedIdx: index("factory_workflow_steps_node_started_idx").on(
      step.workflowId,
      step.nodeId,
      step.startedAt,
    ),
  }),
);

export const factoryWorkflowItemState = table(
  "factory_workflow_item_state",
  {
    workflowId: text("workflow_id").notNull(),
    itemId: text("item_id").notNull(),
    orgId: text("org_id").notNull(),
    factoryId: text("factory_id").notNull(),
    graphVersion: integer("graph_version").notNull(),
    parkedAtNode: text("parked_at_node"),
    wakeJson: text("wake_json"),
    dueAt: text("due_at"),
    nextCheckAt: text("next_check_at"),
    contextJson: text("context_json").notNull().default("{}"),
    countersJson: text("counters_json").notNull().default("{}"),
    leasedBy: text("leased_by"),
    leaseUntil: text("lease_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (state) => ({
    pk: primaryKey({ columns: [state.workflowId, state.itemId] }),
    dueIdx: index("factory_workflow_item_state_due_idx")
      .on(state.workflowId, state.dueAt)
      .where(sql`${state.dueAt} IS NOT NULL`),
    checkIdx: index("factory_workflow_item_state_check_idx")
      .on(state.workflowId, state.nextCheckAt)
      .where(sql`${state.nextCheckAt} IS NOT NULL`),
    leaseIdx: index("factory_workflow_item_state_lease_idx")
      .on(state.workflowId, state.leaseUntil)
      .where(sql`${state.leaseUntil} IS NOT NULL`),
    workflowUpdatedIdx: index("factory_workflow_item_state_updated_idx").on(
      state.orgId,
      state.factoryId,
      state.workflowId,
      state.updatedAt,
    ),
    factoryUpdatedIdx: index(
      "factory_workflow_item_state_factory_updated_idx",
    ).on(
      state.orgId,
      state.factoryId,
      state.updatedAt,
      state.workflowId,
      state.itemId,
    ),
  }),
);

export const factoryWorkflowItemEvents = table(
  "factory_workflow_item_events",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    runId: text("run_id").notNull(),
    itemId: text("item_id").notNull(),
    nodeId: text("node_id"),
    kind: text("kind").notNull(),
    occurredAt: text("occurred_at").notNull(),
    mode: text("mode").notNull(),
    summary: text("summary").notNull().default(""),
    port: text("port"),
    receiptKey: text("receipt_key"),
    threadId: text("thread_id"),
    outcome: text("outcome"),
    code: text("code"),
    orgId: text("org_id").notNull(),
    factoryId: text("factory_id").notNull(),
  },
  (event) => ({
    itemTimeIdx: index("factory_workflow_item_events_item_idx").on(
      event.workflowId,
      event.itemId,
      event.occurredAt,
    ),
    needsYouIdx: index("factory_workflow_item_events_needs_you_idx")
      .on(event.orgId, event.factoryId, event.occurredAt, event.id)
      .where(sql`${event.kind} = 'ended' AND ${event.outcome} = 'needsManual'`),
  }),
);

export const factoryWorkflowReceipts = table(
  "factory_workflow_receipts",
  {
    receiptKey: text("receipt_key").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    orgId: text("org_id").notNull(),
    factoryId: text("factory_id").notNull(),
    status: text("status").notNull(),
    externalRef: text("external_ref"),
    url: text("url"),
    summary: text("summary"),
    // At most 2 KB of the call's response as JSON; `output_truncated` is 1 when it is only part.
    outputJson: text("output_json"),
    outputTruncated: integer("output_truncated"),
    recordedAt: text("recorded_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (receipt) => ({
    workflowIdx: index("factory_workflow_receipts_workflow_idx").on(
      receipt.workflowId,
    ),
  }),
);

// What a click asked of the job: core's run-now carries no payload, so the
// request waits here until the job's manual tick claims it. A row with
// `claimed_at` null is unclaimed; one older than ten minutes is never run.
export const factoryWorkflowRunRequests = table(
  "factory_workflow_run_requests",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    factoryId: text("factory_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    mode: text("mode").notNull(),
    testNodeId: text("test_node_id"),
    sampleItemIdsJson: text("sample_item_ids_json").notNull().default("[]"),
    requestedBy: text("requested_by").notNull(),
    createdAt: text("created_at").notNull(),
    claimedAt: text("claimed_at"),
    claimedByHistoryId: text("claimed_by_history_id"),
  },
  (request) => ({
    pendingIdx: index("factory_workflow_run_requests_pending_idx")
      .on(request.workflowId, request.createdAt, request.id)
      .where(sql`${request.claimedAt} IS NULL`),
  }),
);

// One row per unexpected event a tripwire saw at a risky boundary: ids, status
// codes, durations, counts and the structure of data, never raw values.
// `details_json` is at most 4 KB and written only by `server/tripwire`, which
// keeps the newest 500 rows of each factory.
export const factoryTripwires = table(
  "factory_tripwires",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    factoryId: text("factory_id").notNull(),
    workflowId: text("workflow_id"),
    runId: text("run_id"),
    nodeId: text("node_id"),
    area: text("area").notNull(),
    code: text("code").notNull(),
    severity: text("severity").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (tripwire) => ({
    factoryCreatedIdx: index("factory_tripwires_factory_created_idx").on(
      tripwire.orgId,
      tripwire.factoryId,
      tripwire.createdAt,
    ),
    workflowCreatedIdx: index("factory_tripwires_workflow_created_idx").on(
      tripwire.orgId,
      tripwire.workflowId,
      tripwire.createdAt,
    ),
  }),
);
