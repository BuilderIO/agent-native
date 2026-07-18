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

/** Opaque, revocable private-blob references owned by Content documents. */
export const documentMedia = table(
  "document_media",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
    blobHandleJson: text("blob_handle_json").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    filename: text("filename").notNull(),
    state: text("state").notNull().default("active"),
    deleteError: text("delete_error"),
    revokedAt: text("revoked_at"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (media) => [
    index("document_media_document_state_idx").on(
      media.documentId,
      media.state,
    ),
    index("document_media_owner_document_idx").on(
      media.ownerEmail,
      media.documentId,
    ),
  ],
);

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

/**
 * Exact lineage for grants copied from one document to a child document.
 *
 * This is intentionally separate from the framework-owned shares table. A
 * grant that merely happens to match a parent's grant is not inheritance; only
 * the copy operation writes a row here. Legacy matching rows therefore remain
 * unclassified instead of being guessed during migration.
 */
export const documentShareInheritances = table(
  "document_share_inheritances",
  {
    childShareId: text("child_share_id").primaryKey(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
    sourceShareId: text("source_share_id").notNull(),
    sourceResourceId: text("source_resource_id").notNull(),
    targetResourceId: text("target_resource_id").notNull(),
    createdAt: text("created_at").notNull().default(now()),
  },
  (inheritance) => [
    index("document_share_inheritances_source_idx").on(
      inheritance.sourceResourceId,
      inheritance.sourceShareId,
    ),
    index("document_share_inheritances_target_idx").on(
      inheritance.targetResourceId,
    ),
  ],
);

/** Migration watermark that prevents legacy grants from being mistaken for a
 * fully classified provenance corpus. The count is deliberately aggregate-only. */
export const documentShareProvenanceState = table(
  "document_share_provenance_state",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email")
      .notNull()
      .default("__deployment_security_admin__"),
    orgId: text("org_id"),
    legacyShareRows: integer("legacy_share_rows").notNull(),
    enabledAt: text("enabled_at").notNull().default(now()),
  },
);

/**
 * Opaque hosted-plane state for Content Private Vault beta.
 *
 * `owner_email` and `org_id` are physical authentication-routing aliases for
 * the admitted logical `accountId` and `workspaceId` fields. They deliberately
 * do not use `ownableColumns()`: Private Vault sharing and public visibility
 * remain fail-closed, while every store query must still scope both aliases.
 * Ciphertext bodies live in the separate protected-ciphertext namespace; SQL
 * contains only content-free routing coordinates and validated envelopes.
 */
export const contentEncryptedVaults = table(
  "content_encrypted_vaults",
  {
    vaultId: text("vault_id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    accountId: text("account_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    vaultState: text("vault_state").notNull().default("active"),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (vault) => [
    uniqueIndex("content_encrypted_vaults_logical_scope_unique").on(
      vault.accountId,
      vault.workspaceId,
    ),
    uniqueIndex("content_encrypted_vaults_scope_unique").on(
      vault.ownerEmail,
      vault.orgId,
      vault.accountId,
      vault.workspaceId,
    ),
    uniqueIndex("content_encrypted_vaults_vault_scope_unique").on(
      vault.vaultId,
      vault.ownerEmail,
      vault.orgId,
    ),
  ],
);

/**
 * Immutable account-authorized trust anchor for the first signed control edge.
 * Only public, content-free commitments are retained; admitting a candidate is
 * a separate signed-desktop ceremony, never an effect of control-log replay.
 */
export const contentEncryptedVaultGenesisAdmissions = table(
  "content_encrypted_vault_genesis_admissions",
  {
    vaultId: text("vault_id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    controlEntryId: text("control_entry_id").notNull(),
    controlEntryHash: text("control_entry_hash").notNull(),
    signerEndpointId: text("signer_endpoint_id").notNull(),
    candidateHash: text("candidate_hash").notNull().default(""),
    bootstrapTranscriptHash: text("bootstrap_transcript_hash").notNull(),
    authorizedAt: text("authorized_at").notNull().default(now()),
  },
  (admission) => [
    uniqueIndex("content_encrypted_vault_genesis_admission_entry_unique").on(
      admission.vaultId,
      admission.controlEntryId,
      admission.controlEntryHash,
    ),
    index("content_encrypted_vault_genesis_admission_scope_idx").on(
      admission.ownerEmail,
      admission.orgId,
      admission.vaultId,
    ),
  ],
);

/**
 * Short-lived, content-free account challenges for admitting genesis.
 *
 * Only a hash of the canonical challenge is retained. The random challenge
 * authenticator and the public genesis evidence stay out of SQL; a successful
 * admission atomically marks the exact challenge consumed.
 */
export const contentEncryptedVaultGenesisChallenges = table(
  "content_encrypted_vault_genesis_challenges",
  {
    challengeId: text("challenge_id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull(),
    version: integer("version").notNull().default(1),
    accountId: text("account_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    vaultId: text("vault_id").notNull(),
    candidateHash: text("candidate_hash").notNull(),
    challengeHash: text("challenge_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    issuedAt: text("issued_at").notNull().default(now()),
  },
  (challenge) => [
    uniqueIndex("content_encrypted_vault_genesis_challenge_hash_unique").on(
      challenge.challengeHash,
    ),
    index("content_encrypted_vault_genesis_challenge_scope_expiry_idx").on(
      challenge.ownerEmail,
      challenge.orgId,
      challenge.expiresAt,
    ),
  ],
);

export const contentEncryptedVaultEndpoints = table(
  "content_encrypted_vault_endpoints",
  {
    endpointId: text("endpoint_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    endpointState: text("endpoint_state").notNull(),
    publicIdentityJson: text("public_identity_json").notNull(),
    healthState: text("health_state").notNull().default("unknown"),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (endpoint) => [
    uniqueIndex("content_encrypted_vault_endpoints_vault_endpoint_unique").on(
      endpoint.vaultId,
      endpoint.endpointId,
    ),
    index("content_encrypted_vault_endpoints_scope_state_idx").on(
      endpoint.ownerEmail,
      endpoint.orgId,
      endpoint.vaultId,
      endpoint.endpointState,
    ),
  ],
);

/**
 * Short-lived, content-free replay fence for signed broker requests.
 * Proofs, signatures, request hashes, routes, and payload bytes are forbidden.
 */
export const contentEncryptedVaultEndpointRequestNonces = table(
  "content_encrypted_vault_endpoint_request_nonce_claims_v2",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    endpointId: text("endpoint_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    nonceDigest: text("nonce_digest").notNull(),
    claimedAtBucket: integer("claimed_at_bucket").notNull(),
    expiresAtBucket: integer("expires_at_bucket").notNull(),
  },
  (claim) => [
    uniqueIndex(
      "content_encrypted_vault_endpoint_request_nonce_claims_v2_unique",
    ).on(claim.vaultId, claim.endpointId, claim.nonceDigest),
    index(
      "content_encrypted_vault_endpoint_request_nonce_claims_v2_expiry_idx",
    ).on(claim.expiresAtBucket, claim.id),
  ],
);

/**
 * Read/delete-only bridge for the already-published v79 replay table. New
 * runtime code must never insert here. It can be removed only after every
 * environment has crossed the disclosed backup-purge horizon.
 */
export const contentEncryptedVaultEndpointRequestNoncesLegacy = table(
  "content_encrypted_vault_endpoint_request_nonces",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    endpointId: text("endpoint_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    nonce: text("nonce").notNull(),
    claimedAt: text("claimed_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
);

/**
 * Canonical endpoint-signed control entries. The encoded bytes are the source
 * of authority; indexed columns are content-free routing aliases verified from
 * those bytes before insertion.
 */
export const contentEncryptedVaultControlLogEntries = table(
  "content_encrypted_vault_control_log_entries",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id").notNull(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    sequence: integer("sequence").notNull(),
    previousHash: text("previous_hash").notNull(),
    entryHash: text("entry_hash").notNull(),
    signerEndpointId: text("signer_endpoint_id").notNull(),
    signedAt: text("signed_at").notNull(),
    entryBytesBase64url: text("entry_bytes_base64url").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (entry) => [
    uniqueIndex("content_encrypted_vault_control_log_entry_unique").on(
      entry.vaultId,
      entry.entryId,
    ),
    uniqueIndex("content_encrypted_vault_control_log_sequence_unique").on(
      entry.vaultId,
      entry.sequence,
    ),
    uniqueIndex("content_encrypted_vault_control_log_hash_unique").on(
      entry.vaultId,
      entry.entryHash,
    ),
    index("content_encrypted_vault_control_log_scope_sequence_idx").on(
      entry.ownerEmail,
      entry.orgId,
      entry.vaultId,
      entry.sequence,
    ),
  ],
);

/**
 * CAS projection of the last fully replay-verified control head. It is never
 * accepted from a caller and is checked against canonical entry replay before
 * use. Public keys and endpoint roles are admitted endpoint identity metadata.
 */
export const contentEncryptedVaultControlHeads = table(
  "content_encrypted_vault_control_heads",
  {
    vaultId: text("vault_id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    sequence: integer("sequence").notNull(),
    headHash: text("head_hash").notNull(),
    membershipHash: text("membership_hash").notNull(),
    signedAt: text("signed_at").notNull(),
    epoch: integer("epoch").notNull(),
    activeMembersJson: text("active_members_json").notNull(),
    removedEndpointIdsJson: text("removed_endpoint_ids_json").notNull(),
    freshnessMode: text("freshness_mode").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (head) => [
    index("content_encrypted_vault_control_heads_scope_idx").on(
      head.ownerEmail,
      head.orgId,
      head.vaultId,
    ),
  ],
);

export const contentEncryptedVaultKeyEpochs = table(
  "content_encrypted_vault_key_epochs",
  {
    // Deterministic internal surrogate (`${vaultId}:${epoch}`); it is never
    // serialized into the logical hosted record.
    id: text("id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    epoch: integer("epoch").notNull(),
    state: text("state").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (epoch) => [
    uniqueIndex("content_encrypted_vault_key_epochs_vault_epoch_unique").on(
      epoch.vaultId,
      epoch.epoch,
    ),
    index("content_encrypted_vault_key_epochs_scope_state_idx").on(
      epoch.ownerEmail,
      epoch.orgId,
      epoch.vaultId,
      epoch.state,
    ),
  ],
);

export const contentEncryptedVaultKeyEnvelopes = table(
  "content_encrypted_vault_key_envelopes",
  {
    envelopeId: text("envelope_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    epoch: integer("epoch").notNull(),
    senderEndpointId: text("sender_endpoint_id").notNull(),
    recipientEndpointId: text("recipient_endpoint_id").notNull(),
    algorithmId: text("algorithm_id").notNull(),
    ciphertextByteLength: integer("ciphertext_byte_length").notNull(),
    expiresAt: text("expires_at"),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (envelope) => [
    index("content_encrypted_vault_key_envelopes_recipient_epoch_idx").on(
      envelope.ownerEmail,
      envelope.orgId,
      envelope.vaultId,
      envelope.recipientEndpointId,
      envelope.epoch,
    ),
  ],
);

/**
 * Immutable, content-free binding from a signed control entry to the exact
 * recovery-wrap ciphertext commitment it activated. The encrypted wrap lives
 * only in protected-ciphertext storage; SQL never stores its bytes or locator.
 */
export const contentEncryptedVaultRecoveryWraps = table(
  "content_encrypted_vault_recovery_wraps",
  {
    bindingId: text("binding_id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    vaultId: text("vault_id").notNull(),
    recoveryWrapHash: text("recovery_wrap_hash").notNull(),
    controlEntryId: text("control_entry_id").notNull(),
    ciphertextByteLength: integer("ciphertext_byte_length").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (binding) => [
    uniqueIndex("content_encrypted_vault_recovery_wraps_hash_unique").on(
      binding.vaultId,
      binding.recoveryWrapHash,
    ),
    uniqueIndex(
      "content_encrypted_vault_recovery_wraps_control_entry_unique",
    ).on(binding.vaultId, binding.controlEntryId),
    index("content_encrypted_vault_recovery_wraps_scope_idx").on(
      binding.ownerEmail,
      binding.orgId,
      binding.vaultId,
    ),
  ],
);

/**
 * Immutable binding from a control entry to the exact public evidence required
 * to verify that trust transition independently. Evidence bytes live only in
 * protected-ciphertext storage; SQL retains content-free commitments.
 */
export const contentEncryptedVaultControlEvidence = table(
  "content_encrypted_vault_control_evidence",
  {
    bindingId: text("binding_id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    vaultId: text("vault_id").notNull(),
    controlEntryId: text("control_entry_id").notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    evidenceByteLength: integer("evidence_byte_length").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (binding) => [
    uniqueIndex("content_encrypted_vault_control_evidence_entry_unique").on(
      binding.vaultId,
      binding.controlEntryId,
    ),
    uniqueIndex("content_encrypted_vault_control_evidence_hash_unique").on(
      binding.vaultId,
      binding.evidenceHash,
    ),
    index("content_encrypted_vault_control_evidence_scope_idx").on(
      binding.ownerEmail,
      binding.orgId,
      binding.vaultId,
    ),
  ],
);

export const contentEncryptedVaultGrants = table(
  "content_encrypted_vault_grants",
  {
    grantId: text("grant_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    recipientEndpointId: text("recipient_endpoint_id").notNull(),
    algorithmId: text("algorithm_id").notNull(),
    ciphertextByteLength: integer("ciphertext_byte_length").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (grant) => [
    index("content_encrypted_vault_grants_scope_expiry_idx").on(
      grant.ownerEmail,
      grant.orgId,
      grant.vaultId,
      grant.expiresAt,
    ),
    index("content_encrypted_vault_grants_recipient_idx").on(
      grant.vaultId,
      grant.recipientEndpointId,
    ),
  ],
);

export const contentEncryptedVaultDisclosures = table(
  "content_encrypted_vault_disclosures",
  {
    disclosureId: text("disclosure_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    grantId: text("grant_id").notNull(),
    endpointId: text("endpoint_id").notNull(),
    disclosureEnvelopeJson: text("disclosure_envelope_json").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (disclosure) => [
    index("content_encrypted_vault_disclosures_scope_retention_idx").on(
      disclosure.ownerEmail,
      disclosure.orgId,
      disclosure.vaultId,
      disclosure.serverReceivedAt,
    ),
    index("content_encrypted_vault_disclosures_grant_idx").on(
      disclosure.vaultId,
      disclosure.grantId,
    ),
  ],
);

export const contentEncryptedVaultObjects = table(
  "content_encrypted_vault_objects",
  {
    objectId: text("object_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    objectType: text("object_type").notNull(),
    objectState: text("object_state").notNull().default("active"),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (object) => [
    uniqueIndex("content_encrypted_vault_objects_vault_object_unique").on(
      object.vaultId,
      object.objectId,
    ),
    uniqueIndex("content_encrypted_vault_objects_object_scope_unique").on(
      object.objectId,
      object.vaultId,
      object.ownerEmail,
      object.orgId,
    ),
    index("content_encrypted_vault_objects_scope_type_idx").on(
      object.ownerEmail,
      object.orgId,
      object.vaultId,
      object.objectType,
    ),
  ],
);

export const contentEncryptedVaultObjectRevisions = table(
  "content_encrypted_vault_object_revisions",
  {
    revisionId: text("revision_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    objectId: text("object_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    epoch: integer("epoch").notNull(),
    algorithmId: text("algorithm_id").notNull(),
    ciphertextByteLength: integer("ciphertext_byte_length").notNull(),
    opaqueRevisionJson: text("opaque_revision_json").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (revision) => [
    uniqueIndex("content_encrypted_vault_object_revisions_object_unique").on(
      revision.objectId,
      revision.revisionId,
    ),
    index("content_encrypted_vault_object_revisions_scope_cursor_idx").on(
      revision.ownerEmail,
      revision.orgId,
      revision.vaultId,
      revision.objectId,
      revision.serverReceivedAt,
    ),
  ],
);

export const contentEncryptedVaultSyncEvents = table(
  "content_encrypted_vault_sync_events",
  {
    eventId: text("event_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    objectId: text("object_id"),
    eventType: text("event_type").notNull(),
    opaqueRevisionJson: text("opaque_revision_json"),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (event) => [
    index("content_encrypted_vault_sync_events_scope_cursor_idx").on(
      event.ownerEmail,
      event.orgId,
      event.vaultId,
      event.serverReceivedAt,
      event.eventId,
    ),
  ],
);

export const contentEncryptedVaultJobs = table(
  "content_encrypted_vault_jobs",
  {
    jobId: text("job_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    grantId: text("grant_id").notNull(),
    recipientEndpointId: text("recipient_endpoint_id").notNull(),
    epoch: integer("epoch").notNull(),
    algorithmId: text("algorithm_id").notNull(),
    ciphertextByteLength: integer("ciphertext_byte_length").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    jobState: text("job_state").notNull().default("queued"),
    retryCount: integer("retry_count").notNull().default(0),
    retryAt: text("retry_at"),
    leaseExpiresAt: text("lease_expires_at"),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (job) => [
    uniqueIndex("content_encrypted_vault_jobs_job_scope_unique").on(
      job.jobId,
      job.vaultId,
      job.ownerEmail,
      job.orgId,
    ),
    index("content_encrypted_vault_jobs_queue_idx").on(
      job.ownerEmail,
      job.orgId,
      job.vaultId,
      job.recipientEndpointId,
      job.jobState,
      job.serverReceivedAt,
    ),
    index("content_encrypted_vault_jobs_retention_idx").on(
      job.jobState,
      job.serverReceivedAt,
    ),
  ],
);

export const contentEncryptedVaultJobResults = table(
  "content_encrypted_vault_job_results",
  {
    jobId: text("job_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    endpointId: text("endpoint_id").notNull(),
    epoch: integer("epoch").notNull(),
    jobHash: text("job_hash").notNull(),
    algorithmId: text("algorithm_id").notNull(),
    ciphertextByteLength: integer("ciphertext_byte_length").notNull(),
    jobState: text("job_state").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (result) => [
    index("content_encrypted_vault_job_results_scope_retention_idx").on(
      result.ownerEmail,
      result.orgId,
      result.vaultId,
      result.serverReceivedAt,
    ),
  ],
);

export const contentEncryptedVaultAccessEvents = table(
  "content_encrypted_vault_access_events",
  {
    accessEventId: text("access_event_id").primaryKey(),
    vaultId: text("vault_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    accessEventJson: text("access_event_json").notNull(),
    serverReceivedAt: text("server_received_at").notNull().default(now()),
  },
  (event) => [
    index("content_encrypted_vault_access_events_scope_retention_idx").on(
      event.ownerEmail,
      event.orgId,
      event.vaultId,
      event.serverReceivedAt,
    ),
  ],
);

/**
 * Operational deletion ledger for the opaque Private Vault plane.
 *
 * This table is deliberately outside the logical hosted-record schemas. It
 * stores only authenticated routing aliases, opaque resource coordinates,
 * contractual deadlines, and a content-free crash-recovery phase. Provider
 * locators, plaintext, errors, and user-authored labels are forbidden here.
 */
export const contentEncryptedVaultRetentionQueue = table(
  "content_encrypted_vault_retention_queue",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    vaultId: text("vault_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    epoch: integer("epoch"),
    /** Immutable digest of the terminal transition that created this tombstone. */
    triggerGeneration: text("trigger_generation").notNull(),
    phase: text("phase").notNull().default("pending"),
    triggerAt: text("trigger_at").notNull(),
    dueAt: text("due_at").notNull(),
    deadlineAt: text("deadline_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: text("last_attempt_at"),
    purgedAt: text("purged_at"),
    createdAt: text("created_at").notNull().default(now()),
  },
  (entry) => [
    uniqueIndex("content_encrypted_vault_retention_resource_unique").on(
      entry.ownerEmail,
      entry.orgId,
      entry.vaultId,
      entry.resourceKind,
      entry.resourceId,
    ),
    index("content_encrypted_vault_retention_due_idx").on(
      entry.phase,
      entry.dueAt,
      entry.leaseExpiresAt,
      entry.triggerGeneration,
    ),
    index("content_encrypted_vault_retention_scope_idx").on(
      entry.ownerEmail,
      entry.orgId,
      entry.vaultId,
    ),
  ],
);

/** Deployment-global pin preventing coordinate-only ciphertext from silently
 * moving to a different provider store. The generation is stored only as a
 * one-way digest; provider credentials and locators never enter SQL. */
export const contentEncryptedVaultStorageBindings = table(
  "content_encrypted_vault_storage_bindings",
  {
    bindingId: text("binding_id").primaryKey(),
    providerId: text("provider_id").notNull(),
    generationDigest: text("generation_digest").notNull(),
    boundAt: text("bound_at").notNull().default(now()),
  },
);

/**
 * Pre-Blob crash marker and ABA fence for exact opaque object/job coordinates.
 * The row is created before immutable ciphertext I/O, then becomes a committed
 * or orphaned tombstone. It persists until the matching parent retention
 * tombstone atomically takes over coordinate non-reuse during purge. It never
 * stores bytes or a provider locator.
 */
export const contentEncryptedVaultCiphertextStaging = table(
  "content_encrypted_vault_ciphertext_staging",
  {
    stageId: text("stage_id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull().default(""),
    vaultId: text("vault_id").notNull(),
    coordinateKind: text("coordinate_kind").notNull(),
    objectId: text("object_id"),
    revisionId: text("revision_id"),
    jobId: text("job_id"),
    recoveryWrapHash: text("recovery_wrap_hash"),
    evidenceKind: text("evidence_kind"),
    evidenceHash: text("evidence_hash"),
    part: text("part").notNull(),
    stagedAt: text("staged_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    phase: text("phase").notNull().default("active"),
    claimToken: text("claim_token"),
    claimExpiresAt: text("claim_expires_at"),
    finalizedAt: text("finalized_at"),
  },
  (stage) => [
    index("content_encrypted_vault_ciphertext_staging_expiry_idx").on(
      stage.phase,
      stage.expiresAt,
      stage.claimExpiresAt,
      stage.stageId,
    ),
    index("content_encrypted_vault_ciphertext_staging_scope_idx").on(
      stage.ownerEmail,
      stage.orgId,
      stage.vaultId,
    ),
  ],
);
