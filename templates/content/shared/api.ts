import type {
  DocumentPropertyOptions,
  DocumentPropertyOption,
  DocumentPropertyType,
  DocumentPropertyValue,
  DocumentPropertyVisibility,
} from "./properties";

export type DocumentAccessRole = "owner" | "viewer" | "editor" | "admin";

export interface Document {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  icon: string | null;
  position: number;
  isFavorite: boolean;
  hideFromSearch: boolean;
  notionPageId?: string | null;
  notionPageUrl?: string | null;
  visibility?: "private" | "org" | "public";
  accessRole?: DocumentAccessRole;
  canEdit?: boolean;
  canManage?: boolean;
  source?: DocumentSourceInfo;
  properties?: DocumentProperty[];
  database?: ContentDatabase;
  databaseMembership?: ContentDatabaseMembership;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSourceInfo {
  mode: "database" | "local-files";
  kind?: "file" | "folder" | string;
  path?: string;
  absolutePath?: string;
  rootName?: string;
  rootPath?: string;
  hash?: string;
  contentType?: string;
  sizeBytes?: number;
  updatedAt?: string;
}

export type SyncState = "idle" | "linked" | "syncing" | "error" | "conflict";

export interface DocumentSyncStatus {
  provider: "notion";
  connected: boolean;
  documentId: string;
  pageId: string | null;
  pageUrl: string | null;
  state: SyncState;
  lastSyncedAt: string | null;
  lastKnownRemoteUpdatedAt: string | null;
  lastPushedLocalUpdatedAt: string | null;
  hasConflict: boolean;
  remoteChanged: boolean;
  localChanged: boolean;
  lastError: string | null;
  warnings: string[];
}

export interface NotionConnectionStatus {
  connected: boolean;
  workspaceName: string | null;
  workspaceId: string | null;
  authUrl: string | null;
  error?: "missing_credentials";
  mode?: "oauth" | null;
}

export interface LinkNotionPageRequest {
  pageIdOrUrl: string;
}

export interface CreateNotionPageRequest {
  parentPageIdOrUrl?: string;
}

export interface ResolveDocumentSyncConflictRequest {
  direction: "pull" | "push";
}

export interface DocumentCreateRequest {
  id?: string;
  title?: string;
  parentId?: string | null;
  content?: string;
  icon?: string;
}

export interface DocumentUpdateRequest {
  title?: string;
  content?: string;
  icon?: string | null;
  isFavorite?: boolean;
}

export interface DocumentUpdateResponse extends Document {
  urlPath: string;
  softDeletedDatabaseIds: string[];
}

export interface DocumentMoveRequest {
  parentId?: string | null;
  position?: number;
}

export interface DocumentListResponse {
  documents: Document[];
}

export interface DocumentTreeNode extends Document {
  children: DocumentTreeNode[];
}

export interface NotionSearchResult {
  id: string;
  title: string;
  icon: string | null;
  url: string;
  lastEditedTime: string | null;
}

export interface NotionSearchResponse {
  results: NotionSearchResult[];
  hasMore: boolean;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface DocumentVersionListResponse {
  versions: DocumentVersion[];
}

export type {
  DocumentPropertyOptions,
  DocumentPropertyOption,
  DocumentPropertyType,
  DocumentPropertyValue,
  DocumentPropertyVisibility,
} from "./properties";

export interface DocumentPropertyDefinition {
  id: string;
  databaseId: string | null;
  name: string;
  type: DocumentPropertyType;
  visibility: DocumentPropertyVisibility;
  options: DocumentPropertyOptions;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentProperty {
  definition: DocumentPropertyDefinition;
  value: DocumentPropertyValue;
  editable: boolean;
}

export interface DocumentPropertiesResponse {
  documentId: string;
  databaseId: string | null;
  properties: DocumentProperty[];
}

export interface ConfigureDocumentPropertyRequest {
  id?: string;
  documentId: string;
  name: string;
  type: DocumentPropertyType;
  visibility?: DocumentPropertyVisibility;
  options?: DocumentPropertyOptions;
}

export interface SetDocumentPropertyRequest {
  documentId: string;
  propertyId: string;
  value: DocumentPropertyValue;
}

export interface DuplicateDocumentPropertyRequest {
  documentId: string;
  propertyId: string;
}

export interface DeleteDocumentPropertyRequest {
  documentId: string;
  propertyId: string;
}

export interface ReorderDocumentPropertyRequest {
  documentId: string;
  propertyId: string;
  targetPropertyId: string;
  position?: "before" | "after";
}

export interface ContentDatabase {
  id: string;
  documentId: string;
  title: string;
  viewConfig: ContentDatabaseViewConfig;
  createdAt: string;
  updatedAt: string;
}

export type ContentDatabaseSortDirection = "asc" | "desc";

export interface ContentDatabaseSort {
  key: "name" | string;
  label: string;
  direction: ContentDatabaseSortDirection;
}

export type ContentDatabaseFilterOperator =
  | "contains"
  | "equals"
  | "does_not_equal"
  | "greater_than"
  | "less_than"
  | "before"
  | "after"
  | "is_checked"
  | "is_unchecked"
  | "is_empty"
  | "is_not_empty";

export interface ContentDatabaseFilter {
  key: "name" | string;
  label: string;
  operator: ContentDatabaseFilterOperator;
  value: string;
}

export type ContentDatabaseColumnCalculation =
  | "count_all"
  | "count_values"
  | "count_empty"
  | "count_unique"
  | "percent_filled"
  | "percent_empty"
  | "count_checked"
  | "count_unchecked"
  | "percent_checked"
  | "percent_unchecked"
  | "sum"
  | "average"
  | "median"
  | "min"
  | "max"
  | "range"
  | "date_range";

export type ContentDatabaseViewType =
  | "table"
  | "board"
  | "list"
  | "gallery"
  | "calendar"
  | "timeline";

export type ContentDatabaseRowDensity = "compact" | "default" | "comfortable";
export type ContentDatabaseFilterMode = "and" | "or";
export type ContentDatabaseOpenPagesIn = "preview" | "full_page";

export interface ContentDatabaseView {
  id: string;
  name: string;
  type: ContentDatabaseViewType;
  sorts: ContentDatabaseSort[];
  filters: ContentDatabaseFilter[];
  filterMode?: ContentDatabaseFilterMode;
  columnWidths: Record<string, number>;
  groupByPropertyId?: string | null;
  datePropertyId?: string | null;
  endDatePropertyId?: string | null;
  hiddenPropertyIds?: string[];
  propertyOrderIds?: string[];
  collapsedGroupIds?: string[];
  hideEmptyGroups?: boolean;
  calculations?: Record<string, ContentDatabaseColumnCalculation>;
  wrapCells?: boolean;
  rowDensity?: ContentDatabaseRowDensity;
  openPagesIn?: ContentDatabaseOpenPagesIn;
}

export interface ContentDatabaseViewConfig {
  activeViewId: string;
  views: ContentDatabaseView[];
  sorts: ContentDatabaseSort[];
  filters: ContentDatabaseFilter[];
  columnWidths: Record<string, number>;
}

export interface ContentDatabaseMembership {
  databaseId: string;
  databaseDocumentId: string;
  databaseTitle: string;
  position: number;
}

export interface ContentDatabaseItem {
  id: string;
  databaseId: string;
  document: Document;
  position: number;
  properties: DocumentProperty[];
  sourceRecord?: ContentDatabaseSourceRow;
  // Federation (NEXT): the row's normalized join key, and the read-only columns
  // a secondary source contributes on top of it. Absent for non-federated rows.
  canonicalKey?: string | null;
  sourceOverlays?: ContentDatabaseSourceOverlay[];
}

// A secondary source's read-only contribution to a federated row, matched on the
// canonical key. Kept separate from the primary `sourceRecord` so the existing
// change-set / diff machinery (primary-only, write-oriented) is untouched.
export interface ContentDatabaseSourceOverlay {
  sourceId: string;
  sourceName: string;
  sourceRowId: string;
  values: Record<string, DocumentPropertyValue>;
  fields: ContentDatabaseSourceFieldMapping[];
}

export type ContentDatabaseSourceType =
  | "mock-local"
  | "builder-cms"
  | "local-table";
export type ContentDatabaseSourceSyncState =
  | "idle"
  | "linked"
  | "refreshing"
  | "error";
export type ContentDatabaseSourceFreshness = "unknown" | "fresh" | "stale";
export type ContentDatabaseSourceWriteOwner = "local" | "source" | "derived";
export type ContentDatabaseSourcePushMode =
  | "none"
  | "autosave"
  | "draft"
  | "publish";
export const BUILDER_CMS_SAFE_WRITE_MODEL = "agent-native-blog-article-test";
export type ContentDatabaseSourceChangeDirection = "outbound";
export type ContentDatabaseSourceChangeState =
  | "proposed"
  | "pending_push"
  | "staged_revision"
  | "approved"
  | "applied"
  | "rejected";
export type ContentDatabaseSourceChangeKind =
  | "field_update"
  | "body_update"
  | "metadata_update"
  | "revision_save";
export type ContentDatabaseSourceReviewDecision = "approved" | "rejected";
export type ContentDatabaseSourceRiskLevel = "low" | "medium" | "high";
export type ContentDatabaseSourceConflictState = "none" | "source_changed";
export type ContentDatabaseSourceExecutionState =
  | "ready"
  | "write_disabled"
  | "blocked"
  | "running"
  | "succeeded"
  | "failed";

export interface ContentDatabaseSourceCapabilities {
  canRefresh: boolean;
  canCreateChangeSets: boolean;
  canWriteFields: boolean;
  canWriteBody: boolean;
  canPush: boolean;
  canPull: boolean;
  canPublish: boolean;
  canDelete: boolean;
  canStageLocalRevision: boolean;
  liveWritesEnabled: boolean;
  readOnlyRefresh: boolean;
}

export interface ContentDatabaseSourceFieldMapping {
  id: string;
  propertyId: string | null;
  propertyName: string | null;
  localFieldKey: string;
  sourceFieldKey: string;
  sourceFieldLabel: string;
  sourceFieldType: string;
  mappingType: "title" | "property" | "system";
  writeOwner: ContentDatabaseSourceWriteOwner;
  readOnly: boolean;
  provenance: string;
  freshness: ContentDatabaseSourceFreshness;
  lastSyncedAt: string | null;
}

export interface ContentDatabaseSourceRow {
  id: string;
  databaseItemId: string;
  documentId: string;
  sourceRowId: string;
  sourceQualifiedId: string;
  sourceDisplayKey: string;
  sourceValues?: Record<string, DocumentPropertyValue>;
  provenance: string;
  syncState: ContentDatabaseSourceSyncState;
  freshness: ContentDatabaseSourceFreshness;
  lastSyncedAt: string | null;
  lastSourceUpdatedAt: string | null;
}

export interface ContentDatabaseSourceFieldChange {
  propertyId: string | null;
  propertyName: string | null;
  localFieldKey: string;
  sourceFieldKey: string;
  currentValue: DocumentPropertyValue;
  proposedValue: DocumentPropertyValue;
}

export interface ContentDatabaseSourceBodyChange {
  summary: string;
  currentExcerpt: string | null;
  proposedExcerpt: string | null;
}

export interface ContentDatabaseSourceReviewEvent {
  id: string;
  reviewerEmail: string;
  decision: ContentDatabaseSourceReviewDecision;
  stateFrom: ContentDatabaseSourceChangeState;
  stateTo: ContentDatabaseSourceChangeState;
  note: string | null;
  createdAt: string;
}

export interface ContentDatabaseSourceExecution {
  id: string;
  changeSetId: string;
  adapter: string;
  pushMode: ContentDatabaseSourcePushMode;
  state: ContentDatabaseSourceExecutionState;
  idempotencyKey: string;
  summary: string;
  payload: Record<string, unknown>;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentDatabaseSourceChangeSet {
  id: string;
  databaseItemId: string | null;
  documentId: string | null;
  kind: ContentDatabaseSourceChangeKind;
  direction: ContentDatabaseSourceChangeDirection;
  state: ContentDatabaseSourceChangeState;
  pushMode: ContentDatabaseSourcePushMode | null;
  localOnly: boolean;
  summary: string;
  fieldChanges: ContentDatabaseSourceFieldChange[];
  bodyChange: ContentDatabaseSourceBodyChange | null;
  riskLevel: ContentDatabaseSourceRiskLevel;
  riskReasons: string[];
  conflictState: ContentDatabaseSourceConflictState;
  reviewEvents: ContentDatabaseSourceReviewEvent[];
  executions: ContentDatabaseSourceExecution[];
  createdAt: string;
  updatedAt: string;
}

// A typed join record (NEXT). Only `identity` is built now; the `reference`
// shape is reserved so lookups drop in later with no schema change.
export type ContentDatabaseSourceJoinKind = "identity" | "reference";

export interface ContentDatabaseSourceJoin {
  kind: ContentDatabaseSourceJoinKind;
  // The related collection for a reference join; null for identity.
  collection: string | null;
  // identity → the canonical-key expression; reference → e.g. "{Author}".
  localExpr: string;
  remoteKeyField: string;
  normalizationFormula: string;
}

export type ContentDatabaseSourceRole = "primary" | "secondary";

// A column's source binding (stored now, display-primary only — write fan-out is
// LATER). A "mirror" column keeps multiple sources in sync once live writes land.
export interface ContentDatabaseColumnBinding {
  propertyId: string | null;
  localFieldKey: string | null;
  role: "primary" | "mirror";
  primarySourceId: string | null;
  sourceFieldKey: string;
}

// The shared key space the database's rows are identified by (for display).
export interface ContentDatabaseCanonicalKey {
  propertyId: string | null;
  label: string;
  type: string;
}

// Per-source federation config, stored on each source's metadataJson. The
// primary additionally carries the database-level `canonicalKey` descriptor; a
// secondary carries its `columnBindings`.
export interface ContentDatabaseSourceFederation {
  role: ContentDatabaseSourceRole;
  keyField: string;
  normalizationFormula: string;
  join: ContentDatabaseSourceJoin;
  canonicalKey?: ContentDatabaseCanonicalKey;
  columnBindings?: ContentDatabaseColumnBinding[];
}

export interface ContentDatabaseSource {
  id: string;
  databaseId: string;
  sourceType: ContentDatabaseSourceType;
  sourceName: string;
  sourceTable: string;
  syncState: ContentDatabaseSourceSyncState;
  freshness: ContentDatabaseSourceFreshness;
  lastRefreshedAt: string | null;
  lastSourceUpdatedAt: string | null;
  lastError: string | null;
  capabilities: ContentDatabaseSourceCapabilities;
  metadata: {
    primaryKey: string;
    titleField: string;
    naturalKeyField?: string | null;
    pushMode?: ContentDatabaseSourcePushMode;
    pushModeLabel?: string | null;
    pushModeDescription?: string | null;
    notes?: string | null;
    readMode?: "fixture" | "builder-api" | string | null;
    liveReadConfigured?: boolean;
    lastReadEntryCount?: number;
    lastReadMatchedRowCount?: number;
    allowDraftWrites?: boolean;
    allowPublishWrites?: boolean;
    allowedWriteModes?: ContentDatabaseSourcePushMode[];
    federation?: ContentDatabaseSourceFederation;
  };
  fields: ContentDatabaseSourceFieldMapping[];
  rows: ContentDatabaseSourceRow[];
  changeSets: ContentDatabaseSourceChangeSet[];
}

export interface ContentDatabaseSourceStatusResponse {
  database: ContentDatabase;
  mode: "local" | "source-backed";
  summary: string;
  source: ContentDatabaseSource | null;
}

export interface BuilderCmsModelFieldSummary {
  name: string;
  label?: string;
  type: string;
  required: boolean;
}

export interface BuilderCmsModelSummary {
  id: string;
  name: string;
  displayName: string;
  kind: string;
  fields: BuilderCmsModelFieldSummary[];
}

export interface BuilderCmsModelsResponse {
  state: "live" | "unconfigured" | "error";
  models: BuilderCmsModelSummary[];
  fetchedAt: string;
  message: string | null;
}

export interface ContentDatabaseResponse {
  database: ContentDatabase;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  source: ContentDatabaseSource | null;
  // All attached sources (NEXT). `source` stays as `sources[0] ?? null` for
  // back-compat; multi-source consumers read `sources`.
  sources?: ContentDatabaseSource[];
  pagination?: {
    offset: number;
    limit: number;
    totalItems: number;
    returnedItems: number;
    hasMore: boolean;
  };
  createdItemId?: string;
  createdDocumentId?: string;
  duplicatedItemId?: string;
  duplicatedDocumentId?: string;
}

export interface ContentDatabaseUnavailableResponse {
  available: false;
  reason: "deleted" | "not_found";
  databaseId: string;
  documentId?: string | null;
  deletedAt?: string | null;
  message: string;
}

export interface ContentDatabaseSourceFieldPropertyResponse {
  databaseId: string;
  documentId: string;
  property: DocumentProperty;
  sourceField: ContentDatabaseSourceFieldMapping;
  itemValues?: Array<{
    itemId: string;
    documentId: string;
    value: DocumentPropertyValue;
  }>;
}

export interface CreateDatabaseRequest {
  documentId?: string;
  parentId?: string | null;
  title?: string;
}

export interface CreateInlineDatabaseRequest {
  hostDocumentId: string;
  title?: string;
}

export interface CreateInlineDatabaseResponse {
  database: ContentDatabase;
  block: {
    databaseId: string;
    databaseDocumentId: string;
    ownerBlockId: string;
  };
}

export interface AddDatabaseItemRequest {
  databaseId: string;
  title?: string;
  propertyValues?: Record<string, DocumentPropertyValue>;
}

export interface DuplicateDatabaseItemRequest {
  itemId?: string;
  documentId?: string;
  title?: string;
}

export interface MoveDatabaseItemRequest {
  itemId?: string;
  documentId?: string;
  position: number;
}

export interface UpdateContentDatabaseViewRequest {
  databaseId: string;
  viewConfig: ContentDatabaseViewConfig;
}

// The committed canonical-key join when adding a second source.
export interface ContentDatabaseSourceJoinRequest {
  canonicalKey: { propertyId?: string | null; label: string; type?: string };
  primary: { keyField: string; normalizationFormula: string };
  secondary: { keyField: string; normalizationFormula: string };
  columnBindings?: ContentDatabaseColumnBinding[];
}

export interface AttachContentDatabaseSourceRequest {
  databaseId?: string;
  documentId?: string;
  sourceType?: ContentDatabaseSourceType;
  sourceName?: string;
  sourceTable?: string;
  join?: ContentDatabaseSourceJoinRequest;
  limit?: number;
  offset?: number;
}

export interface ContentDatabaseSummary {
  databaseId: string;
  documentId: string;
  title: string;
}

export interface ListContentDatabasesResponse {
  databases: ContentDatabaseSummary[];
}

export interface TrashedContentDatabaseSummary {
  databaseId: string;
  title: string;
  documentId: string;
  ownerDocumentId: string | null;
  deletedAt: string;
}

export interface ListTrashedContentDatabasesResponse {
  databases: TrashedContentDatabaseSummary[];
}

export interface SuggestSourceJoinKeyRequest {
  databaseId?: string;
  documentId?: string;
  candidateSourceType: ContentDatabaseSourceType;
  candidateSourceTable: string;
  sampleLimit?: number;
}

export interface SourceJoinSampleMatch {
  primaryRaw: string;
  secondaryRaw: string;
  normalized: string;
  matched: boolean;
}

export interface SourceJoinSuggestion {
  source: "heuristic";
  canonicalKey: { propertyId: string | null; label: string; type: string };
  primary: { keyField: string; normalizationFormula: string };
  secondary: { keyField: string; normalizationFormula: string };
  sampleMatches: SourceJoinSampleMatch[];
  confidence: number;
}

export interface SuggestSourceJoinKeyResponse {
  state: "ok" | "no-primary" | "no-overlap";
  suggestion: SourceJoinSuggestion | null;
  message: string | null;
}

export interface RefreshContentDatabaseSourceRequest {
  databaseId?: string;
  documentId?: string;
}

export interface DisconnectContentDatabaseSourceRequest {
  databaseId?: string;
  documentId?: string;
  sourceId?: string;
}

export interface AddContentDatabaseSourceFieldPropertyRequest {
  databaseId?: string;
  documentId?: string;
  sourceFieldId: string;
}

export interface StageBuilderRevisionRequest {
  databaseId?: string;
  documentId?: string;
}

export interface ReviewContentDatabaseSourceChangeSetRequest {
  databaseId?: string;
  documentId?: string;
  changeSetId: string;
  decision: "approve" | "reject";
  note?: string;
}

export interface PrepareBuilderSourceExecutionRequest {
  databaseId?: string;
  documentId?: string;
  changeSetId: string;
  pushModeConfirmation?: ContentDatabaseSourcePushMode;
}

export interface ValidateBuilderSourceExecutionRequest {
  databaseId?: string;
  documentId?: string;
  changeSetId: string;
  idempotencyKey?: string;
}

export interface ExecuteBuilderSourceExecutionRequest {
  databaseId?: string;
  documentId?: string;
  changeSetId: string;
  idempotencyKey?: string;
  pushModeConfirmation?: ContentDatabaseSourcePushMode;
}

export interface SetContentDatabaseSourceWriteModeRequest {
  databaseId?: string;
  documentId?: string;
  liveWritesEnabled: boolean;
  allowedWriteModes?: Exclude<ContentDatabaseSourcePushMode, "none">[];
  allowDraftWrites?: boolean;
  allowPublishWrites?: boolean;
}

export interface PrepareBuilderSourceReviewRequest {
  databaseId?: string;
  documentId?: string;
  pushModeConfirmation?: ContentDatabaseSourcePushMode;
}

export interface ContentDatabaseSourceReviewRowSummary {
  changeSetId: string;
  databaseItemId: string | null;
  documentId: string | null;
  title: string;
  fieldChanges: ContentDatabaseSourceFieldChange[];
  bodyChange: ContentDatabaseSourceBodyChange | null;
  riskLevel: ContentDatabaseSourceRiskLevel;
  riskReasons: string[];
  conflictState: ContentDatabaseSourceConflictState;
  execution: ContentDatabaseSourceExecution | null;
}

export interface ContentDatabaseSourceReviewPayload {
  summary: string;
  sourceName: string;
  sourceTable: string;
  pushMode: ContentDatabaseSourcePushMode;
  dryRunOnly: boolean;
  liveWritesEnabled: boolean;
  riskLevel: ContentDatabaseSourceRiskLevel;
  riskReasons: string[];
  rows: ContentDatabaseSourceReviewRowSummary[];
  result: {
    status:
      | "validated"
      | "blocked"
      | "stale"
      | "write_disabled"
      | "running"
      | "succeeded"
      | "failed";
    message: string;
  };
}

export interface PrepareBuilderSourceReviewResponse {
  database: ContentDatabase;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  source: ContentDatabaseSource | null;
  review: ContentDatabaseSourceReviewPayload;
}
