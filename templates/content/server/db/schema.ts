import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
  index,
  uniqueIndex,
} from "@agent-native/core/db/schema";

export const documents = table("documents", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  title: text("title").notNull().default("Untitled"),
  content: text("content").notNull().default(""),
  // Stable semantic guidance for this page. Ancestry is computed at read time;
  // never copy a parent's description here.
  description: text("description").notNull().default(""),
  icon: text("icon"),
  position: integer("position").notNull().default(0),
  isFavorite: integer("is_favorite").notNull().default(0),
  hideFromSearch: integer("hide_from_search").notNull().default(0),
  sourceMode: text("source_mode"),
  sourceKind: text("source_kind"),
  sourcePath: text("source_path"),
  sourceRootPath: text("source_root_path"),
  sourceUpdatedAt: text("source_updated_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const documentVersions = table("document_versions", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  documentId: text("document_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});

export const documentPreviewDrafts = table(
  "document_preview_drafts",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    documentId: text("document_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    baseDocumentUpdatedAt: text("base_document_updated_at"),
    loadedContentWasEmpty: integer("loaded_content_was_empty")
      .notNull()
      .default(0),
    deferredReason: text("deferred_reason"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (draft) => [
    uniqueIndex("document_preview_drafts_owner_org_document_unique").on(
      draft.ownerEmail,
      draft.orgId,
      draft.documentId,
    ),
    index("document_preview_drafts_owner_org_document_idx").on(
      draft.ownerEmail,
      draft.orgId,
      draft.documentId,
    ),
  ],
);

export const documentComments = table("document_comments", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  documentId: text("document_id").notNull(),
  threadId: text("thread_id").notNull(),
  parentId: text("parent_id"),
  content: text("content").notNull(),
  quotedText: text("quoted_text"),
  anchorPrefix: text("anchor_prefix"),
  anchorSuffix: text("anchor_suffix"),
  anchorStartOffset: integer("anchor_start_offset"),
  mentionsJson: text("mentions_json"),
  authorEmail: text("author_email").notNull(),
  authorName: text("author_name"),
  resolved: integer("resolved").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  notionCommentId: text("notion_comment_id"),
  // Notion's grouping id for a comment thread (a top-level comment and all
  // its replies share one discussion_id). Stored on the local comment so
  // sync-notion-comments can create replies with `discussion_id` instead of
  // `parent`, which is what makes Notion thread them under the existing
  // discussion instead of creating unrelated top-level comments.
  notionDiscussionId: text("notion_discussion_id"),
});

export const documentSyncLinks = table("document_sync_links", {
  documentId: text("document_id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  provider: text("provider").notNull().default("notion"),
  remotePageId: text("remote_page_id").notNull(),
  state: text("state").notNull().default("linked"),
  lastSyncedAt: text("last_synced_at"),
  lastPulledRemoteUpdatedAt: text("last_pulled_remote_updated_at"),
  lastPushedLocalUpdatedAt: text("last_pushed_local_updated_at"),
  lastKnownRemoteUpdatedAt: text("last_known_remote_updated_at"),
  // Hash of the canonical content that is currently identical on both sides.
  // Content-based change detection is immune to timestamp jitter and the
  // normalization mismatches that previously caused no-op syncs to look like
  // real edits (the root of the bidirectional drift).
  lastSyncedContentHash: text("last_synced_content_hash"),
  lastError: text("last_error"),
  warningsJson: text("warnings_json"),
  hasConflict: integer("has_conflict").notNull().default(0),
  syncComments: integer("sync_comments").notNull().default(0),
  // Best-effort cross-instance claim: set to "now" (ISO) by pull/push right
  // before making Notion API calls, cleared afterward. A conditional UPDATE
  // (claim only succeeds if unset or stale) keeps two concurrent syncs for
  // the same document — different tabs, different serverless instances —
  // from racing Notion mutations against each other and corrupting the
  // stored baseline. Best-effort because it does not serialize writes from
  // hosts that skip the claim (e.g. legacy in-flight calls); it narrows the
  // race window rather than eliminating it outright.
  syncClaimedAt: text("sync_claimed_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const builderDocSidecars = table("builder_doc_sidecars", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  orgId: text("org_id"),
  documentId: text("document_id").notNull(),
  path: text("path").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const documentPropertyDefinitions = table(
  "document_property_definitions",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
    databaseId: text("database_id"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility").notNull().default("always_show"),
    optionsJson: text("options_json").notNull().default("{}"),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
);

export const contentDatabases = table("content_databases", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  orgId: text("org_id"),
  documentId: text("document_id").notNull(),
  ownerDocumentId: text("owner_document_id"),
  ownerBlockId: text("owner_block_id"),
  title: text("title").notNull().default("Untitled database"),
  viewConfigJson: text("view_config_json").notNull().default("{}"),
  // Single source of truth for the primary "Content" Blocks field — the one
  // backed by `documents.content`. A DB-enforced single-primary invariant: at
  // most one property id lives here, so two concurrent seeds can never produce
  // two aliasing primaries. NULL means there is currently no primary Blocks
  // field (never seeded, or the primary was intentionally deleted).
  primaryBlocksPropertyId: text("primary_blocks_property_id"),
  // 1 once a database has been seeded with its primary Blocks field at least
  // once. Distinguishes "never seeded" (legacy database needing backfill) from
  // "primary intentionally deleted" (seeded once, then removed — must NOT be
  // reseeded). See delete-document-property.
  blocksSeeded: integer("blocks_seeded").notNull().default(0),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const contentDatabaseItems = table("content_database_items", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  orgId: text("org_id"),
  databaseId: text("database_id").notNull(),
  documentId: text("document_id").notNull(),
  position: integer("position").notNull().default(0),
  bodyHydrationStatus: text("body_hydration_status")
    .notNull()
    .default("hydrated"),
  bodyHydrationAttemptedAt: text("body_hydration_attempted_at"),
  bodyHydrationError: text("body_hydration_error"),
  bodyHydrationVersion: text("body_hydration_version"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const contentDatabaseBodyHydrationQueue = table(
  "content_database_body_hydration_queue",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
    sourceId: text("source_id").notNull(),
    databaseItemId: text("database_item_id").notNull(),
    documentId: text("document_id").notNull(),
    sourceRowId: text("source_row_id").notNull(),
    sourceTable: text("source_table").notNull(),
    sourceEntryJson: text("source_entry_json").notNull().default("{}"),
    priority: integer("priority").notNull().default(10),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptedAt: text("last_attempted_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
);

export const contentDatabaseSources = table("content_database_sources", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  orgId: text("org_id"),
  databaseId: text("database_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceName: text("source_name").notNull(),
  sourceTable: text("source_table").notNull(),
  syncState: text("sync_state").notNull().default("linked"),
  freshness: text("freshness").notNull().default("unknown"),
  capabilitiesJson: text("capabilities_json").notNull().default("{}"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  lastRefreshedAt: text("last_refreshed_at"),
  lastSourceUpdatedAt: text("last_source_updated_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const contentDatabaseSourceFields = table(
  "content_database_source_fields",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    sourceId: text("source_id").notNull(),
    propertyId: text("property_id"),
    localFieldKey: text("local_field_key").notNull(),
    sourceFieldKey: text("source_field_key").notNull(),
    sourceFieldLabel: text("source_field_label").notNull(),
    sourceFieldType: text("source_field_type").notNull(),
    mappingType: text("mapping_type").notNull().default("property"),
    writeOwner: text("write_owner").notNull().default("local"),
    readOnly: integer("read_only").notNull().default(0),
    provenance: text("provenance").notNull().default("local"),
    freshness: text("freshness").notNull().default("unknown"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
);

export const contentDatabaseSourceRows = table("content_database_source_rows", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  sourceId: text("source_id").notNull(),
  databaseItemId: text("database_item_id").notNull(),
  documentId: text("document_id").notNull(),
  sourceRowId: text("source_row_id").notNull(),
  sourceQualifiedId: text("source_qualified_id").notNull(),
  sourceDisplayKey: text("source_display_key").notNull(),
  sourceValuesJson: text("source_values_json").notNull().default("{}"),
  provenance: text("provenance").notNull().default("source"),
  syncState: text("sync_state").notNull().default("linked"),
  freshness: text("freshness").notNull().default("unknown"),
  lastSyncedAt: text("last_synced_at"),
  lastSourceUpdatedAt: text("last_source_updated_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const contentDatabaseSourceChangeSets = table(
  "content_database_source_change_sets",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    sourceId: text("source_id").notNull(),
    databaseItemId: text("database_item_id"),
    documentId: text("document_id"),
    kind: text("kind").notNull().default("field_update"),
    direction: text("direction").notNull().default("incoming"),
    state: text("state").notNull().default("proposed"),
    pushMode: text("push_mode"),
    localOnly: integer("local_only").notNull().default(1),
    summary: text("summary").notNull(),
    fieldChangesJson: text("field_changes_json").notNull().default("[]"),
    bodyChangeJson: text("body_change_json"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
);

export const contentDatabaseSourceChangeReviews = table(
  "content_database_source_change_reviews",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    sourceId: text("source_id").notNull(),
    changeSetId: text("change_set_id").notNull(),
    reviewerEmail: text("reviewer_email").notNull(),
    decision: text("decision").notNull(),
    stateFrom: text("state_from").notNull(),
    stateTo: text("state_to").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull().default(now()),
  },
);

export const contentDatabaseSourceExecutions = table(
  "content_database_source_executions",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    sourceId: text("source_id").notNull(),
    changeSetId: text("change_set_id").notNull(),
    adapter: text("adapter").notNull(),
    pushMode: text("push_mode").notNull(),
    state: text("state").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    summary: text("summary").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    attemptToken: text("attempt_token"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
);

export const contentDatabaseSourceExecutionClaims = table(
  "content_database_source_execution_claims",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    sourceId: text("source_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    executionId: text("execution_id").notNull(),
    createdAt: text("created_at").notNull().default(now()),
  },
);

export const documentPropertyValues = table("document_property_values", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  documentId: text("document_id").notNull(),
  propertyId: text("property_id").notNull(),
  valueJson: text("value_json").notNull().default("null"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

// Independent backing store for ADDITIONAL "Blocks" property fields. The
// default/primary Blocks field ("Content") is backed by `documents.content`
// (so the existing TipTap/Yjs editor, collab, and existing data migrate for
// free). Every other Blocks field on a row gets its OWN content here, keyed by
// (documentId, propertyId) — guaranteeing no two Blocks fields ever alias the
// same content. Stored as markdown, same shape as `documents.content`.
export const documentBlockFieldContents = table(
  "document_block_field_contents",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    documentId: text("document_id").notNull(),
    propertyId: text("property_id").notNull(),
    content: text("content").notNull().default(""),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
);

export const documentShares = createSharesTable("document_shares");
