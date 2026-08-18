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
  sensitivityDisposition: text("sensitivity_disposition", {
    enum: ["pending", "allowed"],
  })
    .notNull()
    .default("pending"),
  sensitivityPolicyVersion: text("sensitivity_policy_version"),
  audienceAclHash: text("audience_acl_hash"),
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
  audienceId: text("audience_id"),
  audienceAclHash: text("audience_acl_hash"),
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
  audienceId: text("audience_id"),
  audienceAclHash: text("audience_acl_hash"),
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
  activeSourceId: text("active_source_id"),
  provider: text("provider").notNull(),
  status: text("status", {
    enum: ["running", "success", "error"],
  })
    .notNull()
    .default("running"),
  statsJson: text("stats_json").notNull().default("{}"),
  error: text("error"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const brainIngestQueue = table("brain_ingest_queue", {
  id: text("id").primaryKey(),
  sourceId: text("source_id"),
  captureId: text("capture_id"),
  operation: text("operation", {
    enum: [
      "distill",
      "sync",
      "search-index",
      "search-unindex",
      "slack-thread-refresh",
    ],
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
  dedupeKey: text("dedupe_key"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  error: text("error"),
  runAfter: text("run_after"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainAudiences = table("brain_audiences", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  kind: text("kind", {
    enum: ["org", "slack-private-channel", "meeting", "restricted"],
  }).notNull(),
  upstreamRefHash: text("upstream_ref_hash"),
  aclHash: text("acl_hash").notNull(),
  membershipState: text("membership_state", {
    enum: ["current", "stale", "error"],
  })
    .notNull()
    .default("stale"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainAudienceMembers = table("brain_audience_members", {
  id: text("id").primaryKey(),
  audienceId: text("audience_id").notNull(),
  principalType: text("principal_type", { enum: ["user", "org"] }).notNull(),
  principalId: text("principal_id").notNull(),
  upstreamPrincipalHash: text("upstream_principal_hash"),
  status: text("status", { enum: ["active", "revoked"] })
    .notNull()
    .default("active"),
  syncedAt: text("synced_at").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainAudienceDependencies = table("brain_audience_dependencies", {
  id: text("id").primaryKey(),
  audienceId: text("audience_id").notNull(),
  dependsOnAudienceId: text("depends_on_audience_id").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});

export const brainAudienceSourceDependencies = table(
  "brain_audience_source_dependencies",
  {
    id: text("id").primaryKey(),
    audienceId: text("audience_id").notNull(),
    sourceId: text("source_id").notNull(),
    createdAt: text("created_at").notNull().default(now()),
  },
);

export const brainCaptureAudiences = table("brain_capture_audiences", {
  id: text("id").primaryKey(),
  captureId: text("capture_id").notNull(),
  audienceId: text("audience_id").notNull(),
  aclHash: text("acl_hash").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});

export const brainSensitivityEvents = table("brain_sensitivity_events", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  captureId: text("capture_id"),
  locatorHmac: text("locator_hmac").notNull(),
  disposition: text("disposition", {
    enum: ["suppressed", "quarantined", "released", "discarded", "expired"],
  }).notNull(),
  categoriesJson: text("categories_json").notNull().default("[]"),
  confidenceBand: text("confidence_band", {
    enum: ["deterministic", "high", "medium", "uncertain"],
  }).notNull(),
  policyVersion: text("policy_version").notNull(),
  upstreamProvider: text("upstream_provider").notNull(),
  quarantineBlobHandle: text("quarantine_blob_handle"),
  expiresAt: text("expires_at"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainSearchArtifacts = table("brain_search_artifacts", {
  id: text("id").primaryKey(),
  captureId: text("capture_id").notNull(),
  sourceId: text("source_id").notNull(),
  audienceId: text("audience_id").notNull(),
  aclHash: text("acl_hash").notNull(),
  title: text("title").notNull(),
  question: text("question").notNull().default(""),
  summary: text("summary").notNull().default(""),
  resolution: text("resolution").notNull().default(""),
  systemsJson: text("systems_json").notNull().default("[]"),
  codeRefsJson: text("code_refs_json").notNull().default("[]"),
  contentHash: text("content_hash").notNull(),
  sensitivityPolicyVersion: text("sensitivity_policy_version").notNull(),
  indexVersion: text("index_version").notNull(),
  status: text("status", { enum: ["active", "stale", "deleted"] })
    .notNull()
    .default("active"),
  capturedAt: text("captured_at").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainSearchBursts = table("brain_search_bursts", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id").notNull(),
  captureId: text("capture_id").notNull(),
  sourceId: text("source_id").notNull(),
  audienceId: text("audience_id").notNull(),
  aclHash: text("acl_hash").notNull(),
  ordinal: integer("ordinal").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  content: text("content").notNull(),
  contextualText: text("contextual_text").notNull(),
  charCount: integer("char_count").notNull(),
  rareTermScore: integer("rare_term_score").notNull().default(0),
  reactionCount: integer("reaction_count").notNull().default(0),
  indexed: integer("indexed").notNull().default(0),
  contentHash: text("content_hash").notNull(),
  indexVersion: text("index_version").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainSearchEmbeddings = table("brain_search_embeddings", {
  id: text("id").primaryKey(),
  targetType: text("target_type", {
    enum: ["artifact", "burst", "knowledge"],
  }).notNull(),
  targetId: text("target_id").notNull(),
  vectorKey: text("vector_key").notNull(),
  sourceId: text("source_id").notNull(),
  audienceId: text("audience_id").notNull(),
  aclHash: text("acl_hash").notNull(),
  embeddingSetId: text("embedding_set_id").notNull(),
  dimensions: integer("dimensions").notNull(),
  contentHash: text("content_hash").notNull(),
  sensitivityPolicyVersion: text("sensitivity_policy_version").notNull(),
  indexVersion: text("index_version").notNull(),
  status: text("status", { enum: ["active", "stale", "deleted"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainTermStats = table("brain_term_stats", {
  term: text("term").primaryKey(),
  documentCount: integer("document_count").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainSearchCorpusStats = table("brain_search_corpus_stats", {
  id: text("id").primaryKey(),
  documentCount: integer("document_count").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const brainProjects = table("brain_projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const brainProjectShares = createSharesTable("brain_project_shares");

export const brainProjectSources = table("brain_project_sources", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  sourceId: text("source_id").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});
