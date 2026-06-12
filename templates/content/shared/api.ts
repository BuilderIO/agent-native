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
}

export type ContentDatabaseSourceType = "mock-local" | "builder-cms";
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
export type ContentDatabaseSourceChangeDirection = "incoming" | "outbound";
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

export interface ContentDatabaseResponse {
  database: ContentDatabase;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  source: ContentDatabaseSource | null;
  createdItemId?: string;
  createdDocumentId?: string;
  duplicatedItemId?: string;
  duplicatedDocumentId?: string;
}

export interface CreateDatabaseRequest {
  documentId?: string;
  parentId?: string | null;
  title?: string;
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

export interface AttachContentDatabaseSourceRequest {
  databaseId?: string;
  documentId?: string;
  sourceType?: ContentDatabaseSourceType;
  sourceName?: string;
  sourceTable?: string;
}

export interface RefreshContentDatabaseSourceRequest {
  databaseId?: string;
  documentId?: string;
}

export interface AddContentDatabaseSourceFieldPropertyRequest {
  databaseId?: string;
  documentId?: string;
  sourceFieldId: string;
}

export interface ProposeContentDatabaseSourceChangeSetRequest {
  databaseId?: string;
  documentId?: string;
  itemDocumentId?: string;
  propertyId?: string;
  includeBodyChange?: boolean;
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
    status: "validated" | "blocked" | "stale" | "write_disabled";
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
