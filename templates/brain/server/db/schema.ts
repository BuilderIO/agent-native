import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const brainSources = table("brain_sources", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  provider: text("provider", {
    enum: ["manual", "generic", "clips", "slack", "granola", "github"],
  })
    .notNull()
    .default("manual"),
  status: text("status", {
    enum: ["active", "paused", "archived", "error"],
  })
    .notNull()
    .default("active"),
  sourceKey: text("source_key"),
  ingestTokenHash: text("ingest_token_hash"),
  configJson: text("config_json").notNull().default("{}"),
  cursorJson: text("cursor_json").notNull().default("{}"),
  lastSyncedAt: text("last_synced_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const brainSourceShares = createSharesTable("brain_source_shares");

export const brainRawCaptures = table("brain_raw_captures", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  externalId: text("external_id"),
  title: text("title").notNull(),
  kind: text("kind", {
    enum: ["transcript", "note", "message", "document", "generic"],
  })
    .notNull()
    .default("generic"),
  content: text("content").notNull(),
  contentHash: text("content_hash"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  capturedAt: text("captured_at").notNull(),
  importedBy: text("imported_by").notNull(),
  status: text("status", {
    enum: ["queued", "distilling", "distilled", "ignored"],
  })
    .notNull()
    .default("queued"),
  distilledAt: text("distilled_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainKnowledge = table("brain_knowledge", {
  id: text("id").primaryKey(),
  sourceId: text("source_id"),
  captureId: text("capture_id"),
  kind: text("kind", {
    enum: [
      "decision",
      "rationale",
      "how-it-works",
      "fact",
      "open-question",
      "process",
      "risk",
      "policy",
    ],
  })
    .notNull()
    .default("fact"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  summary: text("summary").notNull().default(""),
  topic: text("topic"),
  tagsJson: text("tags_json").notNull().default("[]"),
  entitiesJson: text("entities_json").notNull().default("[]"),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  publishedResourcePath: text("published_resource_path"),
  supersedesId: text("supersedes_id"),
  supersededById: text("superseded_by_id"),
  confidence: integer("confidence").notNull().default(80),
  status: text("status", {
    enum: ["draft", "published", "redacted", "archived"],
  })
    .notNull()
    .default("draft"),
  publishTier: text("publish_tier", {
    enum: ["private", "team", "company"],
  })
    .notNull()
    .default("private"),
  createdBy: text("created_by").notNull(),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const brainKnowledgeShares = createSharesTable("brain_knowledge_shares");

export const brainProposals = table("brain_proposals", {
  id: text("id").primaryKey(),
  knowledgeId: text("knowledge_id"),
  sourceId: text("source_id"),
  captureId: text("capture_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  rationale: text("rationale").notNull().default(""),
  proposedAction: text("proposed_action", {
    enum: ["create", "update", "archive"],
  })
    .notNull()
    .default("create"),
  payloadJson: text("payload_json").notNull().default("{}"),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  status: text("status", {
    enum: ["pending", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  reviewerNotes: text("reviewer_notes"),
  createdBy: text("created_by").notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const brainProposalShares = createSharesTable("brain_proposal_shares");

export const brainSyncRuns = table("brain_sync_runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  provider: text("provider").notNull(),
  status: text("status", {
    enum: ["running", "success", "error"],
  })
    .notNull()
    .default("running"),
  statsJson: text("stats_json").notNull().default("{}"),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const brainIngestQueue = table("brain_ingest_queue", {
  id: text("id").primaryKey(),
  sourceId: text("source_id"),
  captureId: text("capture_id"),
  operation: text("operation", {
    enum: ["distill", "sync"],
  })
    .notNull()
    .default("distill"),
  status: text("status", {
    enum: ["queued", "processing", "done", "failed"],
  })
    .notNull()
    .default("queued"),
  priority: integer("priority").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  payloadJson: text("payload_json").notNull().default("{}"),
  error: text("error"),
  runAfter: text("run_after"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});
