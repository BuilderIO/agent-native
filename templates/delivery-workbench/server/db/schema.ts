import {
  createSharesTable,
  index,
  integer,
  ownableColumns,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";

export const workItems = table(
  "delivery_work_items",
  {
    id: text("id").primaryKey(),
    scopeKey: text("scope_key").notNull(),
    provider: text("provider").notNull(),
    sourceId: text("source_id").notNull(),
    sourceUrl: text("source_url"),
    title: text("title").notNull(),
    body: text("body"),
    status: text("status", {
      enum: ["open", "in_progress", "blocked", "done", "cancelled"],
    })
      .notNull()
      .default("open"),
    priority: text("priority", {
      enum: ["low", "normal", "high", "urgent"],
    })
      .notNull()
      .default("normal"),
    assigneeEmail: text("assignee_email"),
    teamId: text("team_id"),
    tagsJson: text("tags_json").notNull().default("[]"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    sourceUpdatedAt: text("source_updated_at"),
    dueAt: text("due_at"),
    lastSnapshotHash: text("last_snapshot_hash"),
    lastIngestRunId: text("last_ingest_run_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...ownableColumns(),
  },
  (t) => ({
    sourceUnique: uniqueIndex("delivery_work_items_source_uidx").on(
      t.scopeKey,
      t.provider,
      t.sourceId,
    ),
    ownerUpdated: index("delivery_work_items_owner_org_updated_idx").on(
      t.ownerEmail,
      t.orgId,
      t.updatedAt,
    ),
    statusUpdated: index("delivery_work_items_status_updated_idx").on(
      t.status,
      t.updatedAt,
    ),
    assigneeUpdated: index("delivery_work_items_assignee_updated_idx").on(
      t.assigneeEmail,
      t.updatedAt,
    ),
  }),
);

export const workItemShares = createSharesTable("delivery_work_item_shares");

export const sourceSnapshots = table(
  "delivery_source_snapshots",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItems.id),
    ingestRunId: text("ingest_run_id").notNull(),
    provider: text("provider").notNull(),
    sourceId: text("source_id").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    normalizedJson: text("normalized_json").notNull(),
    rawRef: text("raw_ref"),
    capturedAt: text("captured_at").notNull(),
    changed: integer("changed", { mode: "boolean" }).notNull().default(false),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (t) => ({
    workItemRun: index("delivery_source_snapshots_work_item_run_idx").on(
      t.workItemId,
      t.ingestRunId,
    ),
    sourceHash: index("delivery_source_snapshots_source_hash_idx").on(
      t.provider,
      t.sourceId,
      t.snapshotHash,
    ),
  }),
);

export const ingestRuns = table(
  "delivery_ingest_runs",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    cursorStart: text("cursor_start"),
    cursorEnd: text("cursor_end"),
    status: text("status", { enum: ["started", "succeeded", "failed"] })
      .notNull()
      .default("started"),
    itemCount: integer("item_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (t) => ({
    providerStarted: index("delivery_ingest_runs_provider_started_idx").on(
      t.provider,
      t.startedAt,
    ),
  }),
);

export const routingSuggestions = table(
  "delivery_routing_suggestions",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItems.id),
    ruleId: text("rule_id"),
    suggestedAssigneeEmail: text("suggested_assignee_email"),
    suggestedTeamId: text("suggested_team_id"),
    reason: text("reason").notNull(),
    confidence: integer("confidence").notNull().default(0),
    createdAt: text("created_at").notNull(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (t) => ({
    workItemCreated: index("delivery_routing_suggestions_work_item_idx").on(
      t.workItemId,
      t.createdAt,
    ),
  }),
);

export const routingRules = table(
  "delivery_routing_rules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    priority: integer("priority").notNull().default(100),
    matchJson: text("match_json").notNull().default("{}"),
    assignToEmail: text("assign_to_email"),
    assignToTeamId: text("assign_to_team_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...ownableColumns(),
  },
  (t) => ({
    ownerPriority: index("delivery_routing_rules_owner_org_priority_idx").on(
      t.ownerEmail,
      t.orgId,
      t.priority,
    ),
  }),
);

export const routingRuleShares = createSharesTable(
  "delivery_routing_rule_shares",
);
