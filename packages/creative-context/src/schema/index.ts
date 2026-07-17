import {
  createSharesTable,
  integer,
  ownableColumns,
  real,
  table,
  text,
} from "@agent-native/core/db/schema";

export { creativeContextMigrations } from "./migrations.js";

const scopedColumns = () => ({
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

export const contextSources = table("creative_context_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  externalRef: text("external_ref"),
  connectionId: text("connection_id"),
  containerOwnerVerifiedAt: text("container_owner_verified_at"),
  config: text("config").notNull().default("{}"),
  upstreamAccess: text("upstream_access", {
    enum: ["available", "restricted", "unknown"],
  })
    .notNull()
    .default("unknown"),
  status: text("status", {
    enum: ["active", "paused", "archived", "error"],
  })
    .notNull()
    .default("active"),
  healthStatus: text("health_status", {
    enum: ["healthy", "stale", "error", "needs_setup", "paused"],
  })
    .notNull()
    .default("stale"),
  syncCursor: text("sync_cursor"),
  itemCount: integer("item_count").notNull().default(0),
  restrictedItemCount: integer("restricted_item_count").notNull().default(0),
  lastSyncedAt: text("last_synced_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const contextSourceShares = createSharesTable(
  "creative_context_source_shares",
);

export const contextSourceAudit = table("creative_context_source_audit", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  operation: text("operation").notNull(),
  actorEmail: text("actor_email").notNull(),
  details: text("details").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const contextItems = table("creative_context_items", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  externalId: text("external_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  canonicalUrl: text("canonical_url"),
  mimeType: text("mime_type"),
  currentVersionId: text("current_version_id").notNull(),
  currentContentHash: text("current_content_hash").notNull(),
  status: text("status", {
    enum: ["active", "deprecated", "deleted", "unavailable"],
  })
    .notNull()
    .default("active"),
  upstreamAccess: text("upstream_access", {
    enum: ["available", "restricted", "unknown"],
  })
    .notNull()
    .default("unknown"),
  curationStatus: text("curation_status", {
    enum: ["included", "excluded", "review"],
  })
    .notNull()
    .default("review"),
  curationRank: text("curation_rank", {
    enum: ["canonical", "exemplar", "normal", "ignored"],
  })
    .notNull()
    .default("normal"),
  starred: integer("starred").notNull().default(0),
  inventoryState: text("inventory_state", {
    enum: ["discovered", "available", "removed", "error"],
  })
    .notNull()
    .default("discovered"),
  indexState: text("index_state", {
    enum: ["pending", "indexed", "stale", "error"],
  })
    .notNull()
    .default("pending"),
  tags: text("tags").notNull().default("[]"),
  colors: text("colors").notNull().default("[]"),
  sortOrder: integer("sort_order").notNull().default(0),
  parentItemId: text("parent_item_id"),
  provenance: text("provenance").notNull().default("{}"),
  thumbnailBlobRef: text("thumbnail_blob_ref"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...scopedColumns(),
});

export const contextItemVersions = table("creative_context_item_versions", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  contentHash: text("content_hash").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  summary: text("summary"),
  mimeType: text("mime_type"),
  sourceModifiedAt: text("source_modified_at"),
  sourceVersion: text("source_version"),
  rawSnapshotBlobRef: text("raw_snapshot_blob_ref"),
  parseStatus: text("parse_status", {
    enum: ["pending", "parsed", "failed"],
  })
    .notNull()
    .default("parsed"),
  parseError: text("parse_error"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const contextChunks = table("creative_context_chunks", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  itemVersionId: text("item_version_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull().default("text"),
  text: text("text").notNull(),
  startOffset: integer("start_offset"),
  endOffset: integer("end_offset"),
  tokenCount: integer("token_count"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const contextMedia = table("creative_context_media", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  itemVersionId: text("item_version_id").notNull(),
  kind: text("kind", {
    enum: ["image", "video", "audio", "document", "other"],
  }).notNull(),
  mimeType: text("mime_type"),
  accessMode: text("access_mode", {
    enum: ["public", "private", "expiring"],
  })
    .notNull()
    .default("public"),
  url: text("url"),
  storageKey: text("storage_key"),
  provenanceUrl: text("provenance_url"),
  altText: text("alt_text"),
  caption: text("caption"),
  captionStatus: text("caption_status", {
    enum: ["pending", "complete", "failed", "not-needed"],
  })
    .notNull()
    .default("pending"),
  ocrText: text("ocr_text"),
  palette: text("palette").notNull().default("[]"),
  contentHash: text("content_hash"),
  width: integer("width"),
  height: integer("height"),
  durationMs: integer("duration_ms"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const contextEdges = table("creative_context_edges", {
  id: text("id").primaryKey(),
  fromItemId: text("from_item_id").notNull(),
  fromItemVersionId: text("from_item_version_id").notNull(),
  toItemId: text("to_item_id"),
  toItemVersionId: text("to_item_version_id"),
  toExternalId: text("to_external_id"),
  relation: text("relation").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const brandProfiles = table("creative_context_brand_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  currentDnaVersionId: text("current_dna_version_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const brandProfileShares = createSharesTable(
  "creative_context_brand_profile_shares",
);

export const brandProfileAudit = table("creative_context_brand_profile_audit", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  operation: text("operation").notNull(),
  actorEmail: text("actor_email").notNull(),
  details: text("details").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const brandDnaVersions = table("creative_context_brand_dna_versions", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  payload: text("payload").notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status", { enum: ["draft", "proposed", "published"] })
    .notNull()
    .default("draft"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const brandDnaEvidence = table("creative_context_brand_dna_evidence", {
  id: text("id").primaryKey(),
  dnaVersionId: text("dna_version_id").notNull(),
  itemId: text("item_id").notNull(),
  itemVersionId: text("item_version_id").notNull(),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const embeddingSets = table("creative_context_embedding_sets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  family: text("family").notNull(),
  model: text("model").notNull(),
  version: text("version").notNull(),
  dimensions: integer("dimensions").notNull(),
  metric: text("metric", {
    enum: ["cosine", "dot", "euclidean"],
  })
    .notNull()
    .default("cosine"),
  status: text("status", { enum: ["active", "retired"] })
    .notNull()
    .default("active"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const embeddings = table("creative_context_embeddings", {
  id: text("id").primaryKey(),
  embeddingSetId: text("embedding_set_id").notNull(),
  family: text("family").notNull(),
  model: text("model").notNull(),
  version: text("version").notNull(),
  itemId: text("item_id").notNull(),
  itemVersionId: text("item_version_id").notNull(),
  chunkId: text("chunk_id"),
  targetType: text("target_type", {
    enum: ["item", "chunk", "media"],
  }).notNull(),
  targetId: text("target_id").notNull(),
  vectorKey: text("vector_key").notNull(),
  dimensions: integer("dimensions").notNull(),
  checksum: text("checksum"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const contextPacks = table("creative_context_packs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  derivedFromPackId: text("derived_from_pack_id"),
  brandDnaVersionId: text("brand_dna_version_id"),
  contextMode: text("context_mode").notNull().default("manual"),
  baseContextId: text("base_context_id"),
  specialtyContextId: text("specialty_context_id"),
  selectionReason: text("selection_reason"),
  request: text("request").notNull().default("{}"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  ...ownableColumns(),
});

export const contextPackShares = createSharesTable(
  "creative_context_pack_shares",
);

export const contextPackMembers = table("creative_context_pack_members", {
  id: text("id").primaryKey(),
  packId: text("pack_id").notNull(),
  itemId: text("item_id").notNull(),
  itemVersionId: text("item_version_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  reason: text("reason"),
  score: real("score"),
  scoreMetadata: text("score_metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const contextPackPins = table("creative_context_pack_pins", {
  id: text("id").primaryKey(),
  packId: text("pack_id").notNull(),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

/** A governed, shareable collection of published creative artifacts. */
export const creativeContexts = table("creative_contexts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind", { enum: ["default", "specialty"] }).notNull(),
  defaultScopeKey: text("default_scope_key"),
  brandProfileId: text("brand_profile_id"),
  stagingSourceId: text("staging_source_id").notNull(),
  // This source is owned by the context and is intentionally not a library source.
  publishedSourceId: text("published_source_id").notNull(),
  approvalPolicy: text("approval_policy", {
    enum: ["open", "review", "admins-only"],
  }).notNull().default("open"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const creativeContextShares = createSharesTable(
  "creative_context_shares",
);

export const creativeContextAudit = table("creative_context_audit", {
  id: text("id").primaryKey(),
  contextId: text("context_id").notNull(),
  operation: text("operation").notNull(),
  actorEmail: text("actor_email").notNull(),
  details: text("details").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

/** One stable row per context/artifact identity; published pointers are mutable. */
export const creativeContextMemberships = table(
  "creative_context_memberships",
  {
    id: text("id").primaryKey(),
    contextId: text("context_id").notNull(),
    artifactKey: text("artifact_key").notNull(),
    publishedItemId: text("published_item_id"),
    publishedItemVersionId: text("published_item_version_id"),
    pendingSubmissionId: text("pending_submission_id"),
    rank: text("rank", { enum: ["canonical", "exemplar", "normal"] })
      .notNull()
      .default("normal"),
    purpose: text("purpose"),
    status: text("status", { enum: ["active", "removed"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...scopedColumns(),
  },
);

/** Submission rows are append-only evidence and staging pointers. */
export const creativeContextSubmissions = table(
  "creative_context_submissions",
  {
    id: text("id").primaryKey(),
    contextId: text("context_id").notNull(),
    membershipId: text("membership_id").notNull(),
    artifactKey: text("artifact_key").notNull(),
    stagingItemId: text("staging_item_id"),
    stagingItemVersionId: text("staging_item_version_id"),
    publishedItemId: text("published_item_id"),
    publishedItemVersionId: text("published_item_version_id"),
    note: text("note"),
    privateMetadata: text("private_metadata").notNull().default("{}"),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "withdrawn", "superseded"],
    }).notNull(),
    submittedBy: text("submitted_by").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewNote: text("review_note"),
    createdAt: text("created_at").notNull(),
    reviewedAt: text("reviewed_at"),
    ...scopedColumns(),
  },
);

export const creativeContextAppBindings = table(
  "creative_context_app_bindings",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull(),
    contextId: text("context_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...scopedColumns(),
  },
);

/** Internal history of publish/materialization operations; never public API. */
export const creativeContextPublishedSnapshots = table(
  "creative_context_published_snapshots",
  {
    id: text("id").primaryKey(),
    contextId: text("context_id").notNull(),
    sourceId: text("source_id").notNull(),
    membershipId: text("membership_id").notNull(),
    itemId: text("item_id").notNull(),
    itemVersionId: text("item_version_id").notNull(),
    submissionId: text("submission_id").notNull(),
    createdAt: text("created_at").notNull(),
    ...scopedColumns(),
  },
);

export const contextJobs = table("creative_context_jobs", {
  id: text("id").primaryKey(),
  dedupeKey: text("dedupe_key"),
  dedupeScope: text("dedupe_scope"),
  scopedDedupeKey: text("scoped_dedupe_key"),
  sourceId: text("source_id"),
  kind: text("kind", {
    enum: [
      "import",
      "embed",
      "enrich-media",
      "brand-dna",
      "canonical-logo",
      "layout-suggestion",
      "metadata-refresh",
      "pack-refresh",
      "purge",
    ],
  }).notNull(),
  status: text("status", {
    enum: ["queued", "running", "paused", "completed", "failed", "cancelled"],
  })
    .notNull()
    .default("queued"),
  mode: text("mode", { enum: ["incremental", "full"] }),
  progressCurrent: integer("progress_current").notNull().default(0),
  progressTotal: integer("progress_total"),
  attempts: integer("attempts").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  nextResumeAt: text("next_resume_at"),
  budget: text("budget"),
  checkpoint: text("checkpoint"),
  request: text("request").notNull().default("{}"),
  result: text("result"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  ...scopedColumns(),
});

export const contextFeedback = table("creative_context_feedback", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  itemVersionId: text("item_version_id").notNull(),
  signal: text("signal", {
    enum: ["helpful", "not-helpful", "incorrect", "outdated"],
  }).notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});

export const contextSuggestions = table("creative_context_suggestions", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["canonical-logo", "layout-template"] }).notNull(),
  status: text("status", {
    enum: ["proposed", "confirmed", "rejected", "promoted", "demoted"],
  })
    .notNull()
    .default("proposed"),
  profileId: text("profile_id"),
  itemId: text("item_id").notNull(),
  itemVersionId: text("item_version_id").notNull(),
  reason: text("reason"),
  payload: text("payload").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...scopedColumns(),
});

export const generationRecords = table("creative_context_generation_records", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull(),
  artifactType: text("artifact_type").notNull(),
  artifactId: text("artifact_id").notNull(),
  contextMode: text("context_mode", {
    enum: ["off", "auto", "pinned"],
  }).notNull(),
  contextPackId: text("context_pack_id"),
  elementProvenance: text("element_provenance").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  ...scopedColumns(),
});
