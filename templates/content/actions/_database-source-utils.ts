import { deleteCollabState, releaseDoc } from "@agent-native/core/collab";
import { getDialect, type Dialect } from "@agent-native/core/db";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabase,
  ContentDatabaseBodyHydrationSummary,
  ContentDatabaseItem,
  ContentDatabaseResponse,
  ContentDatabaseSource,
  ContentDatabaseSourceBodyChange,
  ContentDatabaseSourceCapabilities,
  ContentDatabaseSourceChangeDirection,
  ContentDatabaseSourceChangeKind,
  ContentDatabaseSourceConflictState,
  ContentDatabaseSourceChangeState,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceExecution,
  ContentDatabaseSourceExecutionState,
  ContentDatabaseSourceFederation,
  ContentDatabaseSourceFieldChange,
  ContentDatabaseSourceFieldMapping,
  ContentDatabaseSourceFreshness,
  ContentDatabaseSourcePushMode,
  ContentDatabaseSourceReviewDecision,
  ContentDatabaseSourceReviewEvent,
  ContentDatabaseSourceRiskLevel,
  ContentDatabaseSourceRow,
  ContentDatabaseSourceSyncState,
  ContentDatabaseSourceType,
  ContentDatabaseSourceWriteOwner,
  BuilderCmsModelFieldSummary,
  DocumentProperty,
  DocumentPropertyOptions,
  DocumentPropertyValue,
} from "../shared/api.js";
import {
  builderBlocksHash,
  builderBlocksToReadableMarkdown,
  builderEntryToReadableMdxBundle,
  builderEntryToMdxBundle,
  builderReadableBodyToBuilderBlocks,
  builderMdxBodyToBuilderBlocks,
} from "../shared/builder-mdx.js";
import {
  normalizePropertyValue,
  normalizePropertyValueWithOptions,
  parsePropertyOptions,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptionColor,
} from "../shared/properties.js";
import { sanitizeNormalizationFormula } from "../shared/properties.js";
import { chunks } from "./_batch-utils.js";
import {
  readBuilderCmsContentEntry,
  readBuilderCmsContentEntries,
  readBuilderCmsModelFields,
  type BuilderCmsReadProgress,
  type BuilderCmsReadState,
} from "./_builder-cms-read-client.js";
import {
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  BUILDER_CMS_BODY_READABLE_MAP_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
  BUILDER_CMS_FIXTURE_ROW_PROVENANCE,
  buildBuilderCmsFixtureEntry,
  builderCmsQualifiedId,
  builderCmsSourceFieldKey,
  builderCmsSourceMetadata,
  builderCmsSourceRowIdentity,
  type BuilderCmsSourceEntry,
  type ExistingBuilderSourceRowIdentity,
} from "./_builder-cms-source-adapter.js";
import { mergeBuilderCmsWriteSettingsIntoJson } from "./_builder-cms-write-settings.js";
import { listPropertiesForDatabase, nanoid } from "./_property-utils.js";
import { isEffectivelyEmptyDocumentContent } from "./update-document.js";

type ContentDatabaseRow = typeof schema.contentDatabases.$inferSelect;
type ContentDatabaseSourceRowDb =
  typeof schema.contentDatabaseSources.$inferSelect;
type ContentDatabaseSourceFieldRowDb =
  typeof schema.contentDatabaseSourceFields.$inferSelect;
type ContentDatabaseSourceRecordRowDb =
  typeof schema.contentDatabaseSourceRows.$inferSelect;
type ContentDatabaseItemRowDb = typeof schema.contentDatabaseItems.$inferSelect;
type ContentDatabaseBodyHydrationQueueRowDb =
  typeof schema.contentDatabaseBodyHydrationQueue.$inferSelect;
type ContentDatabaseSourceChangeSetRowDb =
  typeof schema.contentDatabaseSourceChangeSets.$inferSelect;
type ContentDatabaseSourceChangeReviewRowDb =
  typeof schema.contentDatabaseSourceChangeReviews.$inferSelect;
type ContentDatabaseSourceExecutionRowDb =
  typeof schema.contentDatabaseSourceExecutions.$inferSelect;

const DEFAULT_SOURCE_CAPABILITIES: ContentDatabaseSourceCapabilities = {
  canRefresh: true,
  canCreateChangeSets: true,
  canWriteFields: false,
  canWriteBody: false,
  canPush: false,
  canPull: false,
  canPublish: false,
  canDelete: false,
  canStageLocalRevision: false,
  liveWritesEnabled: false,
  readOnlyRefresh: true,
};

type SourceMetadataRecord = {
  primaryKey?: string;
  titleField?: string;
  naturalKeyField?: string | null;
  pushMode?: ContentDatabaseSourcePushMode;
  pushModeLabel?: string | null;
  pushModeDescription?: string | null;
  writeMode?: ContentDatabaseSource["metadata"]["writeMode"];
  allowPublicationTransitions?: boolean;
  notes?: string | null;
  readMode?: string | null;
  liveReadConfigured?: boolean;
  lastReadEntryCount?: number;
  lastReadMatchedRowCount?: number;
  lastReadLimit?: number;
  lastReadFetchedEntryCount?: number;
  lastReadPartial?: boolean;
  lastReadHasMore?: boolean;
  lastReadNextOffset?: number;
  lastReadSuspiciousEmpty?: boolean;
  activeReadSourceRowIds?: string[];
  sourceFetchState?: "idle" | "fetching" | "error" | string;
  allowDraftWrites?: boolean;
  allowPublishWrites?: boolean;
  allowedWriteModes?: ContentDatabaseSourcePushMode[];
  federation?: ContentDatabaseSourceFederation;
  builderModelFields?: BuilderCmsModelFieldSummary[];
};

function parseObject<T extends object>(
  value: string | null | undefined,
): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : null;
  } catch {
    return null;
  }
}

function parseArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function normalizeSourceFreshness(
  value: string | null | undefined,
): ContentDatabaseSourceFreshness {
  return value === "fresh" || value === "stale" ? value : "unknown";
}

export function normalizeSourceSyncState(
  value: string | null | undefined,
): ContentDatabaseSourceSyncState {
  return value === "idle" ||
    value === "linked" ||
    value === "refreshing" ||
    value === "error"
    ? value
    : "linked";
}

function normalizeWriteOwner(
  value: string | null | undefined,
): ContentDatabaseSourceWriteOwner {
  return value === "source" || value === "derived" ? value : "local";
}

function normalizeSourceType(
  value: string | null | undefined,
): ContentDatabaseSourceType {
  if (value === "builder-cms" || value === "local-table") return value;
  return "mock-local";
}

function normalizeChangeKind(
  value: string | null | undefined,
): ContentDatabaseSourceChangeKind {
  return value === "body_update" ||
    value === "metadata_update" ||
    value === "revision_save"
    ? value
    : "field_update";
}

function normalizeChangeDirection(
  _value: string | null | undefined,
): ContentDatabaseSourceChangeDirection {
  // Integrations are the source of truth; change-sets only flow outbound
  // (local → provider). Any legacy "incoming" rows coerce to outbound and are
  // pruned by the resync cleanup.
  return "outbound";
}

function normalizePushMode(
  value: string | null | undefined,
): ContentDatabaseSourcePushMode | null {
  return value === "none" ||
    value === "autosave" ||
    value === "draft" ||
    value === "publish"
    ? value
    : null;
}

function normalizeChangeState(
  value: string | null | undefined,
): ContentDatabaseSourceChangeState {
  return value === "pending_push" ||
    value === "staged_revision" ||
    value === "approved" ||
    value === "applied" ||
    value === "rejected"
    ? value
    : "proposed";
}

function normalizeReviewDecision(
  value: string | null | undefined,
): ContentDatabaseSourceReviewDecision {
  return value === "rejected" ? "rejected" : "approved";
}

function normalizeExecutionState(
  value: string | null | undefined,
): ContentDatabaseSourceExecutionState {
  return value === "ready" ||
    value === "write_disabled" ||
    value === "blocked" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed"
    ? value
    : "blocked";
}

function normalizeCapabilities(
  value: string | null | undefined,
): ContentDatabaseSourceCapabilities {
  const parsed = parseObject<Record<string, unknown>>(value);
  return {
    canRefresh: parsed?.canRefresh !== false,
    canCreateChangeSets: parsed?.canCreateChangeSets !== false,
    canWriteFields: parsed?.canWriteFields === true,
    canWriteBody: parsed?.canWriteBody === true,
    canPush: parsed?.canPush === true,
    canPull: parsed?.canPull === true,
    canPublish: parsed?.canPublish === true,
    canDelete: parsed?.canDelete === true,
    canStageLocalRevision: parsed?.canStageLocalRevision === true,
    liveWritesEnabled: parsed?.liveWritesEnabled === true,
    readOnlyRefresh: parsed?.readOnlyRefresh !== false,
  };
}

function sourceMetadataLabel(
  sourceType: ContentDatabaseSourceType,
  sourceTable: string,
) {
  if (sourceType === "builder-cms") return `builder.cms.${sourceTable}`;
  if (sourceType === "local-table") return `local.table.${sourceTable}`;
  return `mock-local.${sourceTable}`;
}

export function serializeSourceField(
  row: ContentDatabaseSourceFieldRowDb,
  propertyName: string | null,
): ContentDatabaseSourceFieldMapping {
  return {
    id: row.id,
    propertyId: row.propertyId,
    propertyName,
    localFieldKey: row.localFieldKey,
    sourceFieldKey: row.sourceFieldKey,
    sourceFieldLabel: row.sourceFieldLabel,
    sourceFieldType: row.sourceFieldType,
    mappingType:
      row.mappingType === "title" || row.mappingType === "system"
        ? row.mappingType
        : "property",
    writeOwner: normalizeWriteOwner(row.writeOwner),
    readOnly: row.readOnly === 1,
    provenance: row.provenance,
    freshness: normalizeSourceFreshness(row.freshness),
    lastSyncedAt: row.lastSyncedAt,
  };
}

function serializeSourceRowRecord(
  row: ContentDatabaseSourceRecordRowDb,
  options: { includeHeavyBuilderBodyValues?: boolean } = {},
): ContentDatabaseSourceRow {
  return {
    id: row.id,
    databaseItemId: row.databaseItemId,
    documentId: row.documentId,
    sourceRowId: row.sourceRowId,
    sourceQualifiedId: row.sourceQualifiedId,
    sourceDisplayKey: row.sourceDisplayKey,
    sourceValues: sourceValuesForSnapshot(
      parseObject<Record<string, DocumentPropertyValue>>(
        row.sourceValuesJson,
      ) ?? {},
      options,
    ),
    provenance: row.provenance,
    syncState: normalizeSourceSyncState(row.syncState),
    freshness: normalizeSourceFreshness(row.freshness),
    lastSyncedAt: row.lastSyncedAt,
    lastSourceUpdatedAt: row.lastSourceUpdatedAt,
  };
}

const HEAVY_BUILDER_BODY_SOURCE_VALUE_KEYS = new Set([
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  BUILDER_CMS_BODY_READABLE_MAP_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
]);

const SOURCE_VALUES_JSON_COLUMN =
  '"content_database_source_rows"."source_values_json"';

export function sourceSnapshotValuesJsonProjectionSql(dialect: Dialect) {
  const keys = Array.from(HEAVY_BUILDER_BODY_SOURCE_VALUE_KEYS);
  if (dialect === "postgres") {
    return `COALESCE((${SOURCE_VALUES_JSON_COLUMN}::jsonb${keys
      .map((key) => ` - '${key}'`)
      .join("")})::text, '{}')`;
  }
  const paths = keys.map((key) => `'$."${key}"'`);
  return `COALESCE(json_remove(${SOURCE_VALUES_JSON_COLUMN}, ${paths.join(", ")}), '{}')`;
}

function sourceSnapshotRowSelection(args: {
  stripHeavyBuilderBodyValues: boolean;
}) {
  const row = schema.contentDatabaseSourceRows;
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    sourceId: row.sourceId,
    databaseItemId: row.databaseItemId,
    documentId: row.documentId,
    sourceRowId: row.sourceRowId,
    sourceQualifiedId: row.sourceQualifiedId,
    sourceDisplayKey: row.sourceDisplayKey,
    sourceValuesJson: args.stripHeavyBuilderBodyValues
      ? sql<string>`${sql.raw(
          sourceSnapshotValuesJsonProjectionSql(getDialect()),
        )}`
      : row.sourceValuesJson,
    provenance: row.provenance,
    syncState: row.syncState,
    freshness: row.freshness,
    lastSyncedAt: row.lastSyncedAt,
    lastSourceUpdatedAt: row.lastSourceUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function sourceValuesForSnapshot(
  sourceValues: Record<string, DocumentPropertyValue>,
  options: { includeHeavyBuilderBodyValues?: boolean } = {},
): Record<string, DocumentPropertyValue> {
  if (options.includeHeavyBuilderBodyValues === true) return sourceValues;
  let next: Record<string, DocumentPropertyValue> | null = null;
  for (const key of HEAVY_BUILDER_BODY_SOURCE_VALUE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(sourceValues, key)) continue;
    next ??= { ...sourceValues };
    delete next[key];
  }
  return next ?? sourceValues;
}

function serializeSourceChangeSet(
  row: ContentDatabaseSourceChangeSetRowDb,
): ContentDatabaseSourceChangeSet {
  return {
    id: row.id,
    databaseItemId: row.databaseItemId,
    documentId: row.documentId,
    kind: normalizeChangeKind(row.kind),
    direction: normalizeChangeDirection(row.direction),
    state: normalizeChangeState(row.state),
    pushMode: normalizePushMode(row.pushMode),
    localOnly: row.localOnly !== 0,
    summary: row.summary,
    fieldChanges: parseArray<ContentDatabaseSourceFieldChange>(
      row.fieldChangesJson,
    ),
    bodyChange: parseObject<ContentDatabaseSourceBodyChange>(
      row.bodyChangeJson,
    ),
    riskLevel: "low",
    riskReasons: [],
    conflictState: "none",
    reviewEvents: [],
    executions: [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeReviewEvent(
  row: ContentDatabaseSourceChangeReviewRowDb,
): ContentDatabaseSourceReviewEvent {
  return {
    id: row.id,
    reviewerEmail: row.reviewerEmail,
    decision: normalizeReviewDecision(row.decision),
    stateFrom: normalizeChangeState(row.stateFrom),
    stateTo: normalizeChangeState(row.stateTo),
    note: row.note,
    createdAt: row.createdAt,
  };
}

function serializeExecution(
  row: ContentDatabaseSourceExecutionRowDb,
): ContentDatabaseSourceExecution {
  return {
    id: row.id,
    changeSetId: row.changeSetId,
    adapter: row.adapter,
    pushMode: normalizePushMode(row.pushMode) ?? "none",
    state: normalizeExecutionState(row.state),
    idempotencyKey: row.idempotencyKey,
    summary: row.summary,
    payload: parseObject<Record<string, unknown>>(row.payloadJson) ?? {},
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function riskRank(level: ContentDatabaseSourceRiskLevel) {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function maxRisk(
  current: ContentDatabaseSourceRiskLevel,
  next: ContentDatabaseSourceRiskLevel,
) {
  return riskRank(next) > riskRank(current) ? next : current;
}

function reviewedChangeSet(args: {
  changeSet: ContentDatabaseSourceChangeSet;
  source: ContentDatabaseSourceRowDb;
  rowByDocumentId: Map<string, ContentDatabaseSourceRecordRowDb>;
  reviewEvents: ContentDatabaseSourceReviewEvent[];
  executions: ContentDatabaseSourceExecution[];
}): ContentDatabaseSourceChangeSet {
  let riskLevel: ContentDatabaseSourceRiskLevel = "low";
  const riskReasons: string[] = [];

  if (args.changeSet.bodyChange) {
    riskLevel = maxRisk(riskLevel, "medium");
    riskReasons.push("body diff");
  }
  if (args.changeSet.fieldChanges.length > 1) {
    riskLevel = maxRisk(riskLevel, "medium");
    riskReasons.push(`${args.changeSet.fieldChanges.length} field changes`);
  }
  if (!args.changeSet.localOnly) {
    riskLevel = maxRisk(riskLevel, "high");
    riskReasons.push("external write");
  }
  if (!args.changeSet.localOnly && args.changeSet.pushMode === "publish") {
    riskLevel = maxRisk(riskLevel, "high");
    riskReasons.push("publish mode");
  }

  const sourceRow = args.changeSet.documentId
    ? args.rowByDocumentId.get(args.changeSet.documentId)
    : null;
  const sourceChanged =
    sourceRow?.lastSourceUpdatedAt &&
    sourceRow.lastSourceUpdatedAt > args.changeSet.updatedAt;
  const conflictState: ContentDatabaseSourceConflictState = sourceChanged
    ? "source_changed"
    : "none";
  if (sourceChanged) {
    riskLevel = maxRisk(riskLevel, "medium");
    riskReasons.push("source changed after review item");
  }

  return {
    ...args.changeSet,
    riskLevel,
    riskReasons: riskReasons.length ? riskReasons : ["single field diff"],
    conflictState,
    reviewEvents: args.reviewEvents,
    executions: args.executions,
  };
}

// Stable, key-order-insensitive serialization so two same-shape property values
// (source baseline vs local) don't false-diff purely on key order.
function stableValueString(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(stableValueString).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValueString(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Equal when both normalize the same. null/undefined/"" are all "empty"; strings
// are trimmed; objects compared by stable serialization.
function sameSourceFieldValue(a: unknown, b: unknown): boolean {
  const normalize = (value: unknown) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return stableValueString(value);
  };
  return normalize(a) === normalize(b);
}

function sameMappedSourceFieldValue(
  localValue: unknown,
  sourceValue: unknown,
  type: DocumentProperty["definition"]["type"] | null | undefined,
  options?: DocumentPropertyOptions,
): boolean {
  const normalizedLocalValue = type
    ? normalizePropertyValueWithOptions(type, localValue, options)
    : localValue;
  const normalizedSourceValue = type
    ? normalizePropertyValueWithOptions(type, sourceValue, options)
    : sourceValue;
  if (
    type === "multi_select" &&
    Array.isArray(normalizedLocalValue) &&
    Array.isArray(normalizedSourceValue)
  ) {
    // Builder option order is not meaningful. Compare the canonical option IDs
    // as sets so a reordered response does not become an outbound edit.
    return sameSourceFieldValue(
      [...normalizedLocalValue].sort(),
      [...normalizedSourceValue].sort(),
    );
  }
  return sameSourceFieldValue(normalizedLocalValue, normalizedSourceValue);
}

function stringSourceValue(
  values: Record<string, DocumentPropertyValue>,
  key: string,
) {
  const value = values[key];
  return typeof value === "string" ? value : null;
}

function bodyExcerpt(value: string | null | undefined) {
  const excerpt = value?.trim().slice(0, 140) ?? "";
  return excerpt || null;
}

function normalizeBuilderBodyBaselineContent(value: string | null | undefined) {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

const BUILDER_BODY_HYDRATION_BACKGROUND_PRIORITY = 10;
const BUILDER_BODY_HYDRATION_OPEN_PRIORITY = 0;
const BUILDER_BODY_HYDRATION_BATCH_LIMIT = 25;
const BUILDER_BODY_HYDRATION_PROCESS_CONCURRENCY = 6;
const BUILDER_BODY_HYDRATION_MAX_ATTEMPTS = 5;
const BUILDER_BODY_HYDRATION_CODEC_VERSION = "readable-native-images-v5";
const BUILDER_CMS_REFRESH_INITIAL_PAGES = 1;
const BUILDER_BODY_NOT_AVAILABLE_ERROR = "body not yet available from Builder";

export function bulkChunkSizeForColumnCount(
  columnCount: number,
  dialect: Dialect = getDialect(),
) {
  // D1 rejects statements with more than 100 bound params, so derive every
  // bulk chunk from the statement's column count instead of a fixed row count.
  const budget = dialect === "d1" ? 90 : 900;
  return Math.max(1, Math.floor(budget / Math.max(1, columnCount)));
}

function idChunkSize() {
  return bulkChunkSizeForColumnCount(1);
}

async function processInBatches<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  for (const batch of chunks(items, concurrency)) {
    await Promise.all(batch.map((item) => worker(item)));
  }
}

function builderBodyHydrationDelayMs() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.CI ||
    process.env.VITEST
  ) {
    return 0;
  }
  const parsed = Number(process.env.BUILDER_BODY_HYDRATION_DELAY_MS ?? "0");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function builderBodyHydrationPriorityForRequest(args: {
  documentId?: string | null;
}) {
  return args.documentId
    ? BUILDER_BODY_HYDRATION_OPEN_PRIORITY
    : BUILDER_BODY_HYDRATION_BACKGROUND_PRIORITY;
}

export function sortBuilderBodyHydrationQueueForProcessing<
  T extends { priority: number; createdAt: string },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt),
  );
}

export function builderBodyHydrationAttemptIsTerminal(attempts: number) {
  return attempts >= BUILDER_BODY_HYDRATION_MAX_ATTEMPTS;
}

async function builderBodySnapshotForEntry(entry: BuilderCmsSourceEntry) {
  if (!entry.rawEntry) return null;
  const [readableBundle, losslessBundle] = await Promise.all([
    builderEntryToReadableMdxBundle(entry.rawEntry),
    builderEntryToMdxBundle(entry.rawEntry),
  ]);
  const sidecars: Record<string, string> = {};
  for (const [path, source] of Object.entries(losslessBundle.files)) {
    if (path !== losslessBundle.mdx.path) sidecars[path] = source;
  }
  return {
    content: readableBundle.mdx.body,
    losslessContent: losslessBundle.mdx.body,
    blocksHash: builderBlocksHash(losslessBundle.blocks),
    readableMapJson: null,
    sidecarsJson: JSON.stringify(sidecars),
  };
}

export function builderBodyHydrationVersion(entry: BuilderCmsSourceEntry) {
  const hash = stringSourceValue(
    entry.sourceValues,
    BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  );
  return `${hash ?? entry.updatedAt ?? entry.id}:${BUILDER_BODY_HYDRATION_CODEC_VERSION}`;
}

function normalizeHydrationLimit(limit: number | null | undefined) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return BUILDER_BODY_HYDRATION_BATCH_LIMIT;
  }
  return Math.max(1, Math.min(Math.floor(limit), 50));
}

function builderBodyIsRawPlaceholderOnly(content: string | null | undefined) {
  const trimmed = content?.trim() ?? "";
  return (
    trimmed.startsWith("<BuilderRawBlock") &&
    !trimmed.includes("<BuilderText") &&
    !trimmed.includes("<BuilderTabbedContent") &&
    !trimmed.includes("<BuilderCodeBlock")
  );
}

function builderBodyHasLegacyPreservedComponentPlaceholders(
  content: string | null | undefined,
) {
  const value = content ?? "";
  return /^>\s*Builder .+ component preserved from source\.$/m.test(value);
}

function builderBodyWithoutSourceComponentMarkers(
  content: string | null | undefined,
) {
  return (content ?? "")
    .replace(/(?:^|\n)<SourceComponent\b[\s\S]*?\/>[ \t]*(?=\n|$)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function builderBodyWithoutImageSourceComponentMarkers(
  content: string | null | undefined,
) {
  return (content ?? "")
    .replace(/(?:^|\n)<SourceComponent\b[\s\S]*?\/>[ \t]*(?=\n|$)/g, (marker) =>
      marker.includes('componentName="Image"') ? "\n" : marker,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function builderBodyWithoutMarkdownImages(content: string | null | undefined) {
  return (content ?? "")
    .replace(
      /(?:^|\n)!\[(?:\\.|[^\]\\])*\]\(\S+?(?:\s+"[^"]*")?\)[ \t]*(?=\n|$)/g,
      "\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizedBuilderBodyProse(content: string | null | undefined) {
  return (content ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function builderBodyNeedsSourceComponentWrite(args: {
  currentContent: string | null | undefined;
  nextContent: string | null | undefined;
}) {
  const nextContent = args.nextContent ?? "";
  const currentContent = args.currentContent ?? "";
  const needsSourceComponentRefresh =
    nextContent.includes("<SourceComponent") &&
    normalizedBuilderBodyProse(
      builderBodyWithoutSourceComponentMarkers(nextContent),
    ) ===
      normalizedBuilderBodyProse(
        builderBodyWithoutSourceComponentMarkers(currentContent),
      );
  if (needsSourceComponentRefresh) return true;
  if (
    !currentContent.includes('componentName="Image"') ||
    !nextContent.includes("![")
  ) {
    return false;
  }
  return (
    normalizedBuilderBodyProse(
      builderBodyWithoutMarkdownImages(nextContent),
    ) ===
    normalizedBuilderBodyProse(
      builderBodyWithoutImageSourceComponentMarkers(currentContent),
    )
  );
}

function builderStoredBodyIsStale(args: {
  item: Pick<
    ContentDatabaseItemRowDb,
    "bodyHydrationStatus" | "bodyHydrationVersion"
  >;
  entry: BuilderCmsSourceEntry;
}) {
  return (
    args.item.bodyHydrationStatus !== "hydrated" ||
    args.item.bodyHydrationVersion !== builderBodyHydrationVersion(args.entry)
  );
}

function builderEntryHasBodyContent(entry: BuilderCmsSourceEntry | null) {
  return !!stringSourceValue(
    entry?.sourceValues ?? {},
    BUILDER_CMS_BODY_CONTENT_KEY,
  )?.trim();
}

async function readableBuilderBodyFromStoredLossless(args: {
  losslessContent: string | null;
  sidecarsJson: string | null;
}) {
  if (!args.losslessContent?.trim()) return null;
  const sidecars =
    parseObject<Record<string, string>>(args.sidecarsJson ?? "{}") ?? {};
  const blocks = await builderMdxBodyToBuilderBlocks(
    args.losslessContent,
    sidecars,
  );
  if (blocks.length === 0) return null;
  return builderBlocksToReadableMarkdown(blocks);
}

async function refreshBuilderBodySourceValuesFromStoredLossless(
  entry: BuilderCmsSourceEntry,
) {
  const losslessContent = stringSourceValue(
    entry.sourceValues,
    BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  );
  const sidecarsJson = stringSourceValue(
    entry.sourceValues,
    BUILDER_CMS_BODY_SIDECARS_KEY,
  );
  const content = await readableBuilderBodyFromStoredLossless({
    losslessContent,
    sidecarsJson,
  });
  if (!content) return entry;
  return {
    ...entry,
    sourceValues: {
      ...entry.sourceValues,
      [BUILDER_CMS_BODY_CONTENT_KEY]: content,
    },
  };
}

function builderEntryFromSourceRow(args: {
  row: Pick<
    ContentDatabaseSourceRecordRowDb,
    "sourceRowId" | "sourceValuesJson" | "lastSourceUpdatedAt"
  >;
  sourceTable: string;
  fallbackTitle: string;
}): BuilderCmsSourceEntry | null {
  const sourceValues =
    parseObject<Record<string, DocumentPropertyValue>>(
      args.row.sourceValuesJson,
    ) ?? {};
  const id = args.row.sourceRowId;
  if (!id) return null;
  return {
    id,
    model: args.sourceTable,
    title:
      stringSourceValue(sourceValues, "data.title") ??
      stringSourceValue(sourceValues, "title") ??
      args.fallbackTitle,
    urlPath:
      stringSourceValue(sourceValues, "data.url") ??
      stringSourceValue(sourceValues, "url") ??
      "",
    updatedAt:
      args.row.lastSourceUpdatedAt ??
      stringSourceValue(sourceValues, "lastUpdated") ??
      id,
    sourceValues,
  };
}

async function readBuilderEntryWithLiveBodyFromSourceRow(args: {
  row: Pick<
    ContentDatabaseSourceRecordRowDb,
    "sourceRowId" | "sourceValuesJson"
  >;
  sourceTable: string;
  fallbackTitle: string;
}): Promise<BuilderCmsSourceEntry | null> {
  const sourceValues =
    parseObject<Record<string, DocumentPropertyValue>>(
      args.row.sourceValuesJson,
    ) ?? {};
  const liveEntry = await readBuilderCmsContentEntry({
    model: args.sourceTable,
    entryId: args.row.sourceRowId,
  });
  if (!liveEntry || liveEntry.id !== args.row.sourceRowId) return null;
  const entryWithStoredValues = {
    ...liveEntry,
    title: liveEntry.title || args.fallbackTitle,
    sourceValues: {
      ...sourceValues,
      ...liveEntry.sourceValues,
    },
  };
  const refreshedEntry = await refreshBuilderBodySourceValuesFromStoredLossless(
    await withBuilderBodySourceValues(entryWithStoredValues),
  );
  return builderEntryHasBodyContent(refreshedEntry) ? refreshedEntry : null;
}

export async function enqueueBuilderBodyHydration(args: {
  sourceId: string;
  ownerEmail: string;
  orgId: string | null;
  databaseItemId: string;
  documentId: string;
  sourceTable: string;
  entry: BuilderCmsSourceEntry;
  now: string;
  priority?: number;
}) {
  await enqueueBuilderBodyHydrations([args]);
}

type BuilderBodyHydrationEnqueueRequest = {
  sourceId: string;
  ownerEmail: string;
  orgId: string | null;
  databaseItemId: string;
  documentId: string;
  sourceTable: string;
  entry: BuilderCmsSourceEntry;
  now: string;
  priority?: number;
};

async function enqueueBuilderBodyHydrations(
  requests: BuilderBodyHydrationEnqueueRequest[],
): Promise<ContentDatabaseBodyHydrationQueueRowDb[]> {
  if (requests.length === 0) return [];
  const uniqueRequestsByItemId = new Map<
    string,
    BuilderBodyHydrationEnqueueRequest
  >();
  for (const request of requests) {
    const existing = uniqueRequestsByItemId.get(request.databaseItemId);
    if (!existing) {
      uniqueRequestsByItemId.set(request.databaseItemId, request);
      continue;
    }
    const existingPriority =
      existing.priority ??
      builderBodyHydrationPriorityForRequest({ documentId: null });
    const nextPriority =
      request.priority ??
      builderBodyHydrationPriorityForRequest({ documentId: null });
    uniqueRequestsByItemId.set(request.databaseItemId, {
      ...request,
      priority: Math.min(existingPriority, nextPriority),
    });
  }
  const uniqueRequests = Array.from(uniqueRequestsByItemId.values());
  const db = getDb();
  const databaseItemIds = Array.from(
    new Set(uniqueRequests.map((request) => request.databaseItemId)),
  );
  const existingRows: ContentDatabaseBodyHydrationQueueRowDb[] = [];
  for (const idChunk of chunks(databaseItemIds, idChunkSize())) {
    existingRows.push(
      ...(await db
        .select()
        .from(schema.contentDatabaseBodyHydrationQueue)
        .where(
          inArray(
            schema.contentDatabaseBodyHydrationQueue.databaseItemId,
            idChunk,
          ),
        )),
    );
  }
  const existingByItemId = new Map(
    existingRows.map((row) => [row.databaseItemId, row]),
  );
  const queueRows: (typeof schema.contentDatabaseBodyHydrationQueue.$inferInsert)[] =
    [];
  for (const request of uniqueRequests) {
    const existing = existingByItemId.get(request.databaseItemId);
    const existingEntry = existing ? parseHydrationEntry(existing) : null;
    const shouldPreserveExistingEntry =
      builderEntryHasBodyContent(existingEntry) &&
      !builderEntryHasBodyContent(request.entry);
    const priority =
      request.priority ??
      builderBodyHydrationPriorityForRequest({ documentId: null });
    queueRows.push({
      id: existing?.id ?? crypto.randomUUID(),
      ownerEmail: request.ownerEmail,
      orgId: request.orgId,
      sourceId: request.sourceId,
      databaseItemId: request.databaseItemId,
      documentId: request.documentId,
      sourceRowId: request.entry.id,
      sourceTable: request.sourceTable,
      sourceEntryJson: shouldPreserveExistingEntry
        ? existing!.sourceEntryJson
        : JSON.stringify(request.entry),
      priority: Math.min(existing?.priority ?? priority, priority),
      attempts: existing?.attempts ?? 0,
      lastAttemptedAt: existing?.lastAttemptedAt ?? null,
      lastError: null,
      createdAt: existing?.createdAt ?? request.now,
      updatedAt: request.now,
    });
  }
  const upsertedRows: ContentDatabaseBodyHydrationQueueRowDb[] = [];
  for (const chunk of chunks(queueRows, bulkChunkSizeForColumnCount(15))) {
    upsertedRows.push(
      ...(await db
        .insert(schema.contentDatabaseBodyHydrationQueue)
        .values(chunk)
        .onConflictDoUpdate({
          target: schema.contentDatabaseBodyHydrationQueue.databaseItemId,
          set: {
            ownerEmail: sql`excluded.owner_email`,
            orgId: sql`excluded.org_id`,
            sourceId: sql`excluded.source_id`,
            documentId: sql`excluded.document_id`,
            sourceRowId: sql`excluded.source_row_id`,
            sourceTable: sql`excluded.source_table`,
            sourceEntryJson: sql`excluded.source_entry_json`,
            priority: sql`excluded.priority`,
            lastError: null,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning()),
    );
  }
  for (const idChunk of chunks(databaseItemIds, idChunkSize())) {
    await db
      .update(schema.contentDatabaseItems)
      .set({
        bodyHydrationStatus: "pending",
        bodyHydrationError: null,
        updatedAt: uniqueRequests[0]!.now,
      })
      .where(inArray(schema.contentDatabaseItems.id, idChunk));
  }
  return upsertedRows;
}

export async function enqueueBuilderBodyHydrationForItems(args: {
  sourceId: string;
  ownerEmail: string;
  orgId: string | null;
  sourceTable: string;
  items: ContentDatabaseItem[];
  builderEntriesByDocumentId: Map<string, BuilderCmsSourceEntry> | undefined;
  now: string;
}) {
  if (!args.builderEntriesByDocumentId?.size) return;
  const requests: BuilderBodyHydrationEnqueueRequest[] = [];
  for (const item of args.items) {
    const entry = args.builderEntriesByDocumentId.get(item.document.id);
    if (!entry) continue;
    if (
      item.bodyHydration?.status === "hydrated" &&
      item.bodyHydration.version === builderBodyHydrationVersion(entry) &&
      !isEffectivelyEmptyDocumentContent(item.document.content) &&
      !builderBodyIsRawPlaceholderOnly(item.document.content)
    ) {
      continue;
    }
    requests.push({
      sourceId: args.sourceId,
      ownerEmail: args.ownerEmail,
      orgId: args.orgId,
      databaseItemId: item.id,
      documentId: item.document.id,
      sourceTable: args.sourceTable,
      entry,
      now: args.now,
    });
  }
  const queuedJobs = await enqueueBuilderBodyHydrations(requests);
  void processBuilderBodyHydrationQueue({
    sourceId: args.sourceId,
    limit: BUILDER_BODY_HYDRATION_BATCH_LIMIT,
    preloadedJobs: queuedJobs,
  }).catch((error) => {
    console.error("Builder body hydration background kick failed", error);
  });
}

async function enqueueEmptyHydratedBuilderBodiesFromStoredRows(args: {
  source: ContentDatabaseSourceRowDb;
  now: string;
}) {
  const db = getDb();
  const requests: BuilderBodyHydrationEnqueueRequest[] = [];
  const rows = await db
    .select({
      item: {
        id: schema.contentDatabaseItems.id,
        ownerEmail: schema.contentDatabaseItems.ownerEmail,
        orgId: schema.contentDatabaseItems.orgId,
        documentId: schema.contentDatabaseItems.documentId,
      },
      sourceRow: {
        sourceRowId: schema.contentDatabaseSourceRows.sourceRowId,
        sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
        lastSourceUpdatedAt:
          schema.contentDatabaseSourceRows.lastSourceUpdatedAt,
      },
      document: {
        title: schema.documents.title,
        content: schema.documents.content,
      },
    })
    .from(schema.contentDatabaseSourceRows)
    .innerJoin(
      schema.contentDatabaseItems,
      eq(
        schema.contentDatabaseItems.id,
        schema.contentDatabaseSourceRows.databaseItemId,
      ),
    )
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseSourceRows.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseSourceRows.sourceId, args.source.id),
        inArray(schema.contentDatabaseItems.bodyHydrationStatus, [
          "hydrated",
          "pending",
        ]),
        or(
          isNull(schema.documents.content),
          inArray(schema.documents.content, ["", "<empty-block/>"]),
          eq(sql<string>`TRIM(${schema.documents.content})`, ""),
        ),
      ),
    );
  for (const row of rows) {
    const entry = builderEntryFromSourceRow({
      row: row.sourceRow,
      sourceTable: args.source.sourceTable,
      fallbackTitle: row.document.title,
    });
    const refreshedEntry = entry
      ? await refreshBuilderBodySourceValuesFromStoredLossless(entry)
      : null;
    if (!refreshedEntry) continue;
    requests.push({
      sourceId: args.source.id,
      ownerEmail: row.item.ownerEmail,
      orgId: row.item.orgId,
      databaseItemId: row.item.id,
      documentId: row.item.documentId,
      sourceTable: args.source.sourceTable,
      entry: refreshedEntry,
      now: args.now,
    });
  }
  const queuedJobs = await enqueueBuilderBodyHydrations(requests);
  if (queuedJobs.length === 0) return;
  void processBuilderBodyHydrationQueue({
    sourceId: args.source.id,
    limit: BUILDER_BODY_HYDRATION_BATCH_LIMIT,
    preloadedJobs: queuedJobs,
  }).catch((error) => {
    console.error("Builder body hydration repair kick failed", error);
  });
}

function parseHydrationEntry(
  row: ContentDatabaseBodyHydrationQueueRowDb,
): BuilderCmsSourceEntry | null {
  const parsed = parseObject<BuilderCmsSourceEntry>(row.sourceEntryJson);
  return parsed?.id ? parsed : null;
}

async function processBuilderBodyHydrationJob(
  row: ContentDatabaseBodyHydrationQueueRowDb,
  now: string,
  preloaded?: {
    sourceRow?: ContentDatabaseSourceRecordRowDb | null;
    documentContent?: string | null;
  },
) {
  const db = getDb();
  const entry = parseHydrationEntry(row);
  if (!entry) throw new Error("Builder body hydration entry is missing.");
  let activeSourceEntryJson = row.sourceEntryJson;
  let entryWithBody = await refreshBuilderBodySourceValuesFromStoredLossless(
    await withBuilderBodySourceValues(entry),
  );
  const sourceRow =
    preloaded?.sourceRow != null
      ? (preloaded.sourceRow ?? undefined)
      : (
          await db
            .select()
            .from(schema.contentDatabaseSourceRows)
            .where(
              and(
                eq(schema.contentDatabaseSourceRows.sourceId, row.sourceId),
                eq(
                  schema.contentDatabaseSourceRows.databaseItemId,
                  row.databaseItemId,
                ),
              ),
            )
        )[0];
  const sourceValues =
    parseObject<Record<string, DocumentPropertyValue>>(
      sourceRow?.sourceValuesJson ?? "{}",
    ) ?? {};
  let nextValues = {
    ...sourceValues,
    ...entryWithBody.sourceValues,
  };
  let nextContent =
    stringSourceValue(nextValues, BUILDER_CMS_BODY_CONTENT_KEY) ?? "";
  if (!nextContent.trim()) {
    const rebuiltBaseEntry = sourceRow
      ? builderEntryFromSourceRow({
          row: sourceRow,
          sourceTable: row.sourceTable,
          fallbackTitle: entry.title,
        })
      : null;
    const rebuiltEntry = rebuiltBaseEntry
      ? await refreshBuilderBodySourceValuesFromStoredLossless(rebuiltBaseEntry)
      : null;
    if (rebuiltEntry) {
      const rebuiltValues = {
        ...sourceValues,
        ...rebuiltEntry.sourceValues,
      };
      const rebuiltContent =
        stringSourceValue(rebuiltValues, BUILDER_CMS_BODY_CONTENT_KEY) ?? "";
      if (rebuiltContent.trim()) {
        const rebuiltSourceEntryJson = JSON.stringify(rebuiltEntry);
        const [upgraded] = await db
          .update(schema.contentDatabaseBodyHydrationQueue)
          .set({
            sourceEntryJson: rebuiltSourceEntryJson,
            lastError: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.contentDatabaseBodyHydrationQueue.id, row.id),
              eq(
                schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
                activeSourceEntryJson,
              ),
            ),
          )
          .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
        if (!upgraded) return;
        activeSourceEntryJson = rebuiltSourceEntryJson;
        entryWithBody = rebuiltEntry;
        nextValues = rebuiltValues;
        nextContent = rebuiltContent;
      }
    }
    if (!nextContent.trim() && sourceRow) {
      const liveEntry = await readBuilderEntryWithLiveBodyFromSourceRow({
        row: sourceRow,
        sourceTable: row.sourceTable,
        fallbackTitle: entry.title,
      });
      if (liveEntry) {
        const liveValues = {
          ...sourceValues,
          ...liveEntry.sourceValues,
        };
        const liveContent =
          stringSourceValue(liveValues, BUILDER_CMS_BODY_CONTENT_KEY) ?? "";
        if (liveContent.trim()) {
          const liveSourceEntryJson = JSON.stringify(liveEntry);
          const [upgraded] = await db
            .update(schema.contentDatabaseBodyHydrationQueue)
            .set({
              sourceEntryJson: liveSourceEntryJson,
              lastError: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.contentDatabaseBodyHydrationQueue.id, row.id),
                eq(
                  schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
                  activeSourceEntryJson,
                ),
              ),
            )
            .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
          if (!upgraded) return;
          activeSourceEntryJson = liveSourceEntryJson;
          entryWithBody = liveEntry;
          nextValues = liveValues;
          nextContent = liveContent;
        }
      }
    }
    if (!nextContent.trim()) {
      const attempts = row.attempts;
      await db.transaction(async (tx) => {
        const queueRowCas = and(
          eq(schema.contentDatabaseBodyHydrationQueue.id, row.id),
          eq(
            schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
            activeSourceEntryJson,
          ),
        );
        const markPendingIfReplaced = async () => {
          const [replacedByNewerJob] = await tx
            .select({ id: schema.contentDatabaseBodyHydrationQueue.id })
            .from(schema.contentDatabaseBodyHydrationQueue)
            .where(eq(schema.contentDatabaseBodyHydrationQueue.id, row.id));
          if (!replacedByNewerJob) return;
          await tx
            .update(schema.contentDatabaseItems)
            .set({
              bodyHydrationStatus: "pending",
              bodyHydrationAttemptedAt: now,
              bodyHydrationError: null,
              updatedAt: now,
            })
            .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));
        };
        if (builderBodyHydrationAttemptIsTerminal(attempts)) {
          const [deleted] = await tx
            .delete(schema.contentDatabaseBodyHydrationQueue)
            .where(queueRowCas)
            .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
          if (!deleted) {
            await markPendingIfReplaced();
            return;
          }
          await tx
            .update(schema.contentDatabaseItems)
            .set({
              bodyHydrationStatus: "error",
              bodyHydrationAttemptedAt: now,
              bodyHydrationError: BUILDER_BODY_NOT_AVAILABLE_ERROR,
              updatedAt: now,
            })
            .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));
          return;
        }
        const [stillOwnsQueueRow] = await tx
          .update(schema.contentDatabaseBodyHydrationQueue)
          .set({
            lastError: BUILDER_BODY_NOT_AVAILABLE_ERROR,
            updatedAt: now,
          })
          .where(queueRowCas)
          .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
        if (!stillOwnsQueueRow) {
          await markPendingIfReplaced();
          return;
        }
        await tx
          .update(schema.contentDatabaseItems)
          .set({
            bodyHydrationStatus: "pending",
            bodyHydrationAttemptedAt: now,
            bodyHydrationError: null,
            updatedAt: now,
          })
          .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));
      });
      return;
    }
  }
  const documentContent =
    preloaded?.documentContent != null
      ? preloaded.documentContent
      : (
          await db
            .select({ content: schema.documents.content })
            .from(schema.documents)
            .where(eq(schema.documents.id, row.documentId))
        )[0]?.content;
  const previousContent =
    stringSourceValue(sourceValues, BUILDER_CMS_BODY_CONTENT_KEY) ?? "";
  const currentContent = documentContent ?? "";
  const shouldWriteBody =
    currentContent === "" ||
    isEffectivelyEmptyDocumentContent(currentContent) ||
    currentContent === previousContent ||
    currentContent.trim() === "" ||
    builderBodyIsRawPlaceholderOnly(currentContent) ||
    builderBodyHasLegacyPreservedComponentPlaceholders(currentContent) ||
    builderBodyNeedsSourceComponentWrite({
      currentContent,
      nextContent,
    });
  let wroteBody = false;
  await db.transaction(async (tx) => {
    const queueRowCas = and(
      eq(schema.contentDatabaseBodyHydrationQueue.id, row.id),
      eq(
        schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
        activeSourceEntryJson,
      ),
    );
    const markPendingIfReplaced = async () => {
      const [replacedByNewerJob] = await tx
        .select({ id: schema.contentDatabaseBodyHydrationQueue.id })
        .from(schema.contentDatabaseBodyHydrationQueue)
        .where(eq(schema.contentDatabaseBodyHydrationQueue.id, row.id));
      if (!replacedByNewerJob) return;
      await tx
        .update(schema.contentDatabaseItems)
        .set({
          bodyHydrationStatus: "pending",
          bodyHydrationAttemptedAt: now,
          bodyHydrationError: null,
          updatedAt: now,
        })
        .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));
    };
    const [stillOwnsQueueRow] = await tx
      .update(schema.contentDatabaseBodyHydrationQueue)
      .set({
        updatedAt: now,
      })
      .where(queueRowCas)
      .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
    if (!stillOwnsQueueRow) {
      await markPendingIfReplaced();
      return;
    }
    if (shouldWriteBody) {
      const contentCas =
        isEffectivelyEmptyDocumentContent(currentContent) &&
        isEffectivelyEmptyDocumentContent(previousContent)
          ? inArray(schema.documents.content, ["", "<empty-block/>"])
          : eq(schema.documents.content, currentContent);
      const [updatedDocument] = await tx
        .update(schema.documents)
        .set({ content: nextContent, updatedAt: now })
        .where(and(eq(schema.documents.id, row.documentId), contentCas))
        .returning({ id: schema.documents.id });
      wroteBody = Boolean(updatedDocument);
    }
    if (shouldWriteBody && !wroteBody) {
      // Only mark the item pending if our queue row still exists. If a
      // concurrent processor already completed (and deleted) this job, it
      // owns the final `hydrated` status — resetting to pending here would
      // strand the item as a zombie (pending with no queue row).
      const [stillQueued] = await tx
        .update(schema.contentDatabaseBodyHydrationQueue)
        .set({
          lastError:
            "Skipped Builder body hydration because the document changed during sync.",
          updatedAt: now,
        })
        .where(queueRowCas)
        .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
      if (stillQueued) {
        await tx
          .update(schema.contentDatabaseItems)
          .set({
            bodyHydrationStatus: "pending",
            bodyHydrationAttemptedAt: now,
            bodyHydrationError:
              "Skipped Builder body hydration because the document changed during sync.",
            updatedAt: now,
          })
          .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));
      }
      return;
    }
    const sourceRowWhere = and(
      eq(schema.contentDatabaseSourceRows.sourceId, row.sourceId),
      eq(schema.contentDatabaseSourceRows.databaseItemId, row.databaseItemId),
      sourceRow
        ? eq(
            schema.contentDatabaseSourceRows.sourceValuesJson,
            sourceRow.sourceValuesJson,
          )
        : isNull(schema.contentDatabaseSourceRows.id),
    );
    const [updatedSourceRow] = await tx
      .update(schema.contentDatabaseSourceRows)
      .set({
        sourceValuesJson: JSON.stringify(nextValues),
        lastSyncedAt: now,
        lastSourceUpdatedAt: entryWithBody.updatedAt ?? now,
        updatedAt: now,
      })
      .where(sourceRowWhere)
      .returning({ id: schema.contentDatabaseSourceRows.id });
    if (!updatedSourceRow) {
      const [stillQueued] = await tx
        .update(schema.contentDatabaseBodyHydrationQueue)
        .set({
          lastError:
            "Skipped Builder body hydration because the source row changed during sync.",
          updatedAt: now,
        })
        .where(queueRowCas)
        .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
      if (stillQueued) {
        await tx
          .update(schema.contentDatabaseItems)
          .set({
            bodyHydrationStatus: "pending",
            bodyHydrationAttemptedAt: now,
            bodyHydrationError:
              "Skipped Builder body hydration because the source row changed during sync.",
            updatedAt: now,
          })
          .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));
      }
      return;
    }
    const [deleted] = await tx
      .delete(schema.contentDatabaseBodyHydrationQueue)
      .where(queueRowCas)
      .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
    if (!deleted) {
      // Our delete matched nothing: either a NEWER job version replaced this
      // row (same id, different sourceEntryJson — mark pending so the newer
      // job's processor owns it), or a concurrent processor completed and
      // deleted the job — in which case it already set `hydrated`, and
      // resetting to pending would strand the item with no queue row.
      const [replacedByNewerJob] = await tx
        .select({ id: schema.contentDatabaseBodyHydrationQueue.id })
        .from(schema.contentDatabaseBodyHydrationQueue)
        .where(eq(schema.contentDatabaseBodyHydrationQueue.id, row.id));
      if (replacedByNewerJob) {
        await tx
          .update(schema.contentDatabaseItems)
          .set({
            bodyHydrationStatus: "pending",
            bodyHydrationAttemptedAt: now,
            bodyHydrationError: null,
            updatedAt: now,
          })
          .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));
      }
      return;
    }
    await tx
      .update(schema.contentDatabaseItems)
      .set({
        bodyHydrationStatus: "hydrated",
        bodyHydrationAttemptedAt: now,
        bodyHydrationError: null,
        bodyHydrationVersion: builderBodyHydrationVersion(entryWithBody),
        updatedAt: now,
      })
      .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));
  });
  if (wroteBody) {
    try {
      await deleteCollabState(row.documentId);
      releaseDoc(row.documentId);
    } catch {
      // Non-fatal: the updated document row still lets open editors reconcile.
    }
  }
}

async function enqueueStaleBuilderBodyHydrationForOpenDocument(args: {
  sourceId: string;
  documentId: string;
  now: string;
}) {
  const db = getDb();
  const [row] = await db
    .select({
      source: schema.contentDatabaseSources,
      item: schema.contentDatabaseItems,
      sourceRow: schema.contentDatabaseSourceRows,
      document: schema.documents,
    })
    .from(schema.contentDatabaseSourceRows)
    .innerJoin(
      schema.contentDatabaseSources,
      eq(
        schema.contentDatabaseSources.id,
        schema.contentDatabaseSourceRows.sourceId,
      ),
    )
    .innerJoin(
      schema.contentDatabaseItems,
      eq(
        schema.contentDatabaseItems.id,
        schema.contentDatabaseSourceRows.databaseItemId,
      ),
    )
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseSourceRows.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseSourceRows.sourceId, args.sourceId),
        eq(schema.contentDatabaseSourceRows.documentId, args.documentId),
      ),
    );
  if (!row || row.source.sourceType !== "builder-cms") return;
  const entry = builderEntryFromSourceRow({
    row: row.sourceRow,
    sourceTable: row.source.sourceTable,
    fallbackTitle: row.document.title,
  });
  if (!entry) return;
  const refreshedEntry =
    await refreshBuilderBodySourceValuesFromStoredLossless(entry);
  if (
    !builderStoredBodyIsStale({ item: row.item, entry: refreshedEntry }) &&
    !builderBodyHasLegacyPreservedComponentPlaceholders(row.document.content) &&
    !builderBodyNeedsSourceComponentWrite({
      currentContent: row.document.content,
      nextContent: stringSourceValue(
        refreshedEntry.sourceValues,
        BUILDER_CMS_BODY_CONTENT_KEY,
      ),
    })
  ) {
    return;
  }
  await enqueueBuilderBodyHydration({
    sourceId: args.sourceId,
    ownerEmail: row.item.ownerEmail,
    orgId: row.item.orgId,
    databaseItemId: row.item.id,
    documentId: row.item.documentId,
    sourceTable: row.source.sourceTable,
    entry: refreshedEntry,
    now: args.now,
    priority: BUILDER_BODY_HYDRATION_OPEN_PRIORITY,
  });
}

export async function processBuilderBodyHydrationQueue(args: {
  sourceId: string;
  documentId?: string | null;
  limit?: number | null;
  preloadedJobs?: ContentDatabaseBodyHydrationQueueRowDb[];
}) {
  const db = getDb();
  const limit = normalizeHydrationLimit(args.limit);
  const now = new Date().toISOString();
  if (args.documentId) {
    await enqueueStaleBuilderBodyHydrationForOpenDocument({
      sourceId: args.sourceId,
      documentId: args.documentId,
      now,
    });
    await db
      .update(schema.contentDatabaseBodyHydrationQueue)
      .set({
        priority: BUILDER_BODY_HYDRATION_OPEN_PRIORITY,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.contentDatabaseBodyHydrationQueue.sourceId, args.sourceId),
          eq(
            schema.contentDatabaseBodyHydrationQueue.documentId,
            args.documentId,
          ),
        ),
      );
  }
  const persistedJobs = async (queryLimit: number) =>
    db
      .select()
      .from(schema.contentDatabaseBodyHydrationQueue)
      .where(
        args.documentId
          ? and(
              eq(
                schema.contentDatabaseBodyHydrationQueue.sourceId,
                args.sourceId,
              ),
              eq(
                schema.contentDatabaseBodyHydrationQueue.documentId,
                args.documentId,
              ),
            )
          : eq(
              schema.contentDatabaseBodyHydrationQueue.sourceId,
              args.sourceId,
            ),
      )
      .orderBy(
        asc(schema.contentDatabaseBodyHydrationQueue.priority),
        asc(schema.contentDatabaseBodyHydrationQueue.createdAt),
      )
      .limit(queryLimit);
  const jobs = await (args.preloadedJobs?.length && !args.documentId
    ? (() => {
        const preloadedJobs = sortBuilderBodyHydrationQueueForProcessing(
          args.preloadedJobs!.filter((job) => job.sourceId === args.sourceId),
        ).slice(0, limit);
        return persistedJobs(limit + preloadedJobs.length).then((rows) => {
          const preloadedIds = new Set(preloadedJobs.map((job) => job.id));
          return sortBuilderBodyHydrationQueueForProcessing([
            ...preloadedJobs,
            ...rows.filter((row) => !preloadedIds.has(row.id)),
          ]).slice(0, limit);
        });
      })()
    : persistedJobs(limit));

  let succeeded = 0;
  let failed = 0;
  const claimedJobs: ContentDatabaseBodyHydrationQueueRowDb[] = [];
  for (const jobChunk of chunks(jobs, bulkChunkSizeForColumnCount(2))) {
    const claimFilters = jobChunk.map((job) =>
      and(
        eq(schema.contentDatabaseBodyHydrationQueue.id, job.id),
        eq(
          schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
          job.sourceEntryJson,
        ),
      ),
    );
    if (claimFilters.length === 0) continue;
    claimedJobs.push(
      ...(await db
        .update(schema.contentDatabaseBodyHydrationQueue)
        .set({
          attempts: sql`${schema.contentDatabaseBodyHydrationQueue.attempts} + 1`,
          lastAttemptedAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(or(...claimFilters))
        .returning()),
    );
  }
  for (const idChunk of chunks(
    claimedJobs.map((job) => job.databaseItemId),
    idChunkSize(),
  )) {
    await db
      .update(schema.contentDatabaseItems)
      .set({
        bodyHydrationStatus: "hydrating",
        bodyHydrationAttemptedAt: now,
        bodyHydrationError: null,
        updatedAt: now,
      })
      .where(inArray(schema.contentDatabaseItems.id, idChunk));
  }
  const sourceRows =
    claimedJobs.length > 0
      ? (
          await Promise.all(
            chunks(
              claimedJobs.map((job) => job.databaseItemId),
              idChunkSize(),
            ).map((idChunk) =>
              db
                .select()
                .from(schema.contentDatabaseSourceRows)
                .where(
                  and(
                    eq(
                      schema.contentDatabaseSourceRows.sourceId,
                      args.sourceId,
                    ),
                    inArray(
                      schema.contentDatabaseSourceRows.databaseItemId,
                      idChunk,
                    ),
                  ),
                ),
            ),
          )
        ).flat()
      : [];
  const sourceRowsByItemId = new Map(
    sourceRows.map((row) => [row.databaseItemId, row]),
  );
  const documents =
    claimedJobs.length > 0
      ? (
          await Promise.all(
            chunks(
              Array.from(new Set(claimedJobs.map((job) => job.documentId))),
              idChunkSize(),
            ).map((idChunk) =>
              db
                .select({
                  id: schema.documents.id,
                  content: schema.documents.content,
                })
                .from(schema.documents)
                .where(inArray(schema.documents.id, idChunk)),
            ),
          )
        ).flat()
      : [];
  const documentContentById = new Map(
    documents.map((document) => [document.id, document.content]),
  );
  await processInBatches(
    claimedJobs,
    BUILDER_BODY_HYDRATION_PROCESS_CONCURRENCY,
    async (job) => {
      const attemptNow = new Date().toISOString();
      try {
        const delayMs = builderBodyHydrationDelayMs();
        if (delayMs > 0) await sleep(delayMs);
        await processBuilderBodyHydrationJob(job, attemptNow, {
          sourceRow: sourceRowsByItemId.get(job.databaseItemId) ?? null,
          documentContent: documentContentById.has(job.documentId)
            ? (documentContentById.get(job.documentId) ?? null)
            : undefined,
        });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        const attempts = job.attempts;
        const queueRowCas = and(
          eq(schema.contentDatabaseBodyHydrationQueue.id, job.id),
          eq(
            schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
            job.sourceEntryJson,
          ),
        );
        const markPendingIfReplaced = async () => {
          const [replacedByNewerJob] = await db
            .select({ id: schema.contentDatabaseBodyHydrationQueue.id })
            .from(schema.contentDatabaseBodyHydrationQueue)
            .where(eq(schema.contentDatabaseBodyHydrationQueue.id, job.id));
          if (!replacedByNewerJob) return;
          await db
            .update(schema.contentDatabaseItems)
            .set({
              bodyHydrationStatus: "pending",
              bodyHydrationAttemptedAt: attemptNow,
              bodyHydrationError: null,
              updatedAt: attemptNow,
            })
            .where(eq(schema.contentDatabaseItems.id, job.databaseItemId));
        };
        if (builderBodyHydrationAttemptIsTerminal(attempts)) {
          const [deleted] = await db
            .delete(schema.contentDatabaseBodyHydrationQueue)
            .where(queueRowCas)
            .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
          if (!deleted) {
            await markPendingIfReplaced();
            return;
          }
          await db
            .update(schema.contentDatabaseItems)
            .set({
              bodyHydrationStatus: "error",
              bodyHydrationAttemptedAt: attemptNow,
              bodyHydrationError: message,
              updatedAt: attemptNow,
            })
            .where(eq(schema.contentDatabaseItems.id, job.databaseItemId));
          return;
        }
        const [updatedQueueRow] = await db
          .update(schema.contentDatabaseBodyHydrationQueue)
          .set({
            attempts,
            lastAttemptedAt: attemptNow,
            lastError: message,
            priority: job.priority + 10,
            updatedAt: attemptNow,
          })
          .where(queueRowCas)
          .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
        if (!updatedQueueRow) {
          await markPendingIfReplaced();
          return;
        }
        await db
          .update(schema.contentDatabaseItems)
          .set({
            bodyHydrationStatus: "error",
            bodyHydrationAttemptedAt: attemptNow,
            bodyHydrationError: message,
            updatedAt: attemptNow,
          })
          .where(eq(schema.contentDatabaseItems.id, job.databaseItemId));
      }
    },
  );
  const [remaining] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.contentDatabaseBodyHydrationQueue)
    .where(
      eq(schema.contentDatabaseBodyHydrationQueue.sourceId, args.sourceId),
    );
  return {
    sourceId: args.sourceId,
    processed: claimedJobs.length,
    succeeded,
    failed,
    remaining: Number(remaining?.count ?? 0),
  };
}

export async function withBuilderBodySourceValues(
  entry: BuilderCmsSourceEntry,
): Promise<BuilderCmsSourceEntry> {
  const snapshot = await builderBodySnapshotForEntry(entry);
  if (!snapshot) return entry;
  return {
    ...entry,
    sourceValues: {
      ...entry.sourceValues,
      [BUILDER_CMS_BODY_CONTENT_KEY]: snapshot.content,
      [BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY]: snapshot.losslessContent,
      [BUILDER_CMS_BODY_READABLE_MAP_KEY]: snapshot.readableMapJson,
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: snapshot.blocksHash,
      [BUILDER_CMS_BODY_SIDECARS_KEY]: snapshot.sidecarsJson,
    },
  };
}

export async function withBuilderBodiesSourceValues(
  entries: BuilderCmsSourceEntry[],
) {
  return Promise.all(
    entries.map((entry) => withBuilderBodySourceValues(entry)),
  );
}

export async function builderBodyChangeForLocalContent(args: {
  row: Pick<ContentDatabaseSourceRecordRowDb, "sourceValuesJson">;
  localContent: string | null | undefined;
}): Promise<ContentDatabaseSourceBodyChange | null> {
  const sourceValues =
    parseObject<Record<string, DocumentPropertyValue>>(
      args.row.sourceValuesJson,
    ) ?? {};
  const currentHash = stringSourceValue(
    sourceValues,
    BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  );
  const currentContent = stringSourceValue(
    sourceValues,
    BUILDER_CMS_BODY_CONTENT_KEY,
  );
  const losslessContent = stringSourceValue(
    sourceValues,
    BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
  );
  const sidecarsJson =
    stringSourceValue(sourceValues, BUILDER_CMS_BODY_SIDECARS_KEY) ?? "{}";
  const localContent = args.localContent ?? "";
  if (!currentHash && !currentContent && !localContent.trim()) return null;
  if (!currentContent?.trim() && !losslessContent?.trim()) return null;
  const normalizedLocalContent =
    normalizeBuilderBodyBaselineContent(localContent);
  if (
    normalizedLocalContent &&
    normalizedLocalContent ===
      normalizeBuilderBodyBaselineContent(currentContent)
  ) {
    return null;
  }
  if (
    normalizedLocalContent &&
    normalizedLocalContent ===
      normalizeBuilderBodyBaselineContent(losslessContent)
  ) {
    return null;
  }

  let sidecars: Record<string, string> = {};
  try {
    const parsed = JSON.parse(sidecarsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      sidecars = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } catch {
    sidecars = {};
  }

  try {
    const proposed =
      losslessContent && !localContent.includes("<Builder")
        ? await builderReadableBodyToBuilderBlocks({
            localContent,
            losslessContent,
            sidecars,
          })
        : {
            blocks: await builderMdxBodyToBuilderBlocks(localContent, sidecars),
            warnings: [] as string[],
          };
    if (!proposed.blocks) {
      return {
        summary: "Builder body blocks changed, but need attention before push.",
        currentExcerpt: bodyExcerpt(currentContent),
        proposedExcerpt: bodyExcerpt(localContent),
        currentHash,
        proposedHash: null,
        proposedContent: localContent,
        proposedBlocksJson: null,
        sidecarsJson,
        warnings: proposed.warnings,
      };
    }
    const proposedBlocks = proposed.blocks;
    const proposedHash = builderBlocksHash(proposedBlocks);
    if (currentHash && proposedHash === currentHash) return null;
    return {
      summary: "Builder body blocks changed.",
      currentExcerpt: bodyExcerpt(currentContent),
      proposedExcerpt: bodyExcerpt(localContent),
      currentHash,
      proposedHash,
      proposedContent: localContent,
      proposedBlocksJson: JSON.stringify(proposedBlocks),
      sidecarsJson,
      warnings: proposed.warnings,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Builder body could not be converted.";
    return {
      summary: "Builder body blocks changed, but need attention before push.",
      currentExcerpt: bodyExcerpt(currentContent),
      proposedExcerpt: bodyExcerpt(localContent),
      currentHash,
      proposedHash: null,
      proposedContent: localContent,
      proposedBlocksJson: null,
      sidecarsJson,
      warnings: [message],
    };
  }
}

export function buildBuilderLocalOutboundChangeSets(args: {
  source: ContentDatabaseSourceRowDb;
  rowRows: ContentDatabaseSourceRecordRowDb[];
  documentTitleById: Map<string, string>;
  storedChangeSets: ContentDatabaseSourceChangeSet[];
  // Optional inputs that enable new-row creates. When omitted (e.g. legacy
  // callers/tests) the function behaves exactly as before (title diffs only).
  databaseItems?: Array<{ databaseItemId: string; documentId: string }>;
  localValuesByDocument?: Map<string, Map<string, unknown>>;
  writableFields?: Array<{
    propertyId: string | null;
    localFieldKey: string;
    sourceFieldKey: string;
    sourceFieldLabel: string;
    propertyType?: DocumentProperty["definition"]["type"] | null;
    propertyOptions?: DocumentPropertyOptions;
  }>;
  // Row-union scoping (multi-source). Documents owned by ANOTHER source must
  // never be create candidates for this one — each row belongs to exactly one
  // collection. And a truly unsourced ("Local") row creates only against the
  // primary, not every attached collection. Both default to the single-source
  // behavior when omitted (no other owners; creates allowed).
  otherSourceDocumentIds?: Set<string>;
  allowUnsourcedCreates?: boolean;
  // Per-document ownership from the visible "Source" select tag (documentId →
  // owning sourceId). A new, still-unlinked row tagged for a specific
  // collection is adopted as a create_draft by THAT collection only; an
  // untagged / "Local" row falls back to the primary (allowUnsourcedCreates).
  taggedSourceByDocumentId?: Map<string, string>;
  bodyChangeByDocumentId?: Map<string, ContentDatabaseSourceBodyChange>;
  sourceImportedDocumentIds?: Set<string>;
}): ContentDatabaseSourceChangeSet[] {
  if (normalizeSourceType(args.source.sourceType) !== "builder-cms") return [];

  const sourceMetadata =
    parseObject<SourceMetadataRecord>(args.source.metadataJson) ?? {};
  const skipFixtureRows =
    sourceMetadata.liveReadConfigured === true ||
    normalizeCapabilities(args.source.capabilitiesJson).liveWritesEnabled ===
      true;
  const pending: ContentDatabaseSourceChangeSet[] = [];
  for (const row of args.rowRows) {
    if (
      skipFixtureRows &&
      row.provenance === BUILDER_CMS_FIXTURE_ROW_PROVENANCE
    ) {
      continue;
    }

    const sourceTitle = row.sourceDisplayKey.trim();
    const localTitle = args.documentTitleById.get(row.documentId)?.trim() ?? "";
    const fieldChanges: ContentDatabaseSourceFieldChange[] = [];
    if (localTitle && localTitle !== sourceTitle) {
      fieldChanges.push({
        propertyId: null,
        propertyName: "Title",
        localFieldKey: "title",
        sourceFieldKey: "data.title",
        currentValue: sourceTitle,
        proposedValue: localTitle,
      });
    }
    // Diff every mapped property field: local value vs the synced source
    // baseline (same-shape DocumentPropertyValue, stable compare). An absent
    // local value means "not loaded", not "cleared" — skip it.
    const rowLocalValues = args.localValuesByDocument?.get(row.documentId);
    if (rowLocalValues) {
      const rowSourceValues =
        parseObject<Record<string, DocumentPropertyValue>>(
          row.sourceValuesJson,
        ) ?? {};
      for (const field of args.writableFields ?? []) {
        if (!rowLocalValues.has(field.localFieldKey)) continue;
        const localValue = rowLocalValues.get(field.localFieldKey);
        const baseValue = rowSourceValues[field.sourceFieldKey];
        if (
          sameMappedSourceFieldValue(
            localValue,
            baseValue,
            field.propertyType,
            field.propertyOptions,
          )
        ) {
          continue;
        }
        fieldChanges.push({
          propertyId: field.propertyId,
          propertyName: field.sourceFieldLabel,
          localFieldKey: field.localFieldKey,
          sourceFieldKey: field.sourceFieldKey,
          currentValue: (field.propertyType
            ? normalizePropertyValueWithOptions(
                field.propertyType,
                baseValue,
                field.propertyOptions,
              )
            : (baseValue ?? null)) as DocumentPropertyValue,
          proposedValue: localValue as DocumentPropertyValue,
        });
      }
    }
    const bodyChange = args.bodyChangeByDocumentId?.get(row.documentId) ?? null;
    if (fieldChanges.length === 0 && !bodyChange) continue;
    // Skip if this row already has a live (non-rejected/applied) stored outbound
    // autosave change-set — the stored one is what's being reviewed/pushed.
    const matchesStoredChange = args.storedChangeSets.some((changeSet) => {
      if (
        changeSet.direction !== "outbound" ||
        changeSet.documentId !== row.documentId ||
        changeSet.pushMode !== "autosave" ||
        changeSet.state === "rejected" ||
        changeSet.state === "applied"
      ) {
        return false;
      }
      return (
        changeSet.fieldChanges.some((stored) =>
          fieldChanges.some((change) => {
            if (change.localFieldKey !== stored.localFieldKey) return false;
            const writableField = args.writableFields?.find(
              (field) => field.localFieldKey === change.localFieldKey,
            );
            const sameStoredValue = (current: unknown, previous: unknown) =>
              writableField
                ? sameMappedSourceFieldValue(
                    current,
                    previous,
                    writableField.propertyType,
                    writableField.propertyOptions,
                  )
                : sameSourceFieldValue(current, previous);
            return (
              sameStoredValue(change.currentValue, stored.currentValue) &&
              sameStoredValue(change.proposedValue, stored.proposedValue)
            );
          }),
        ) ||
        (!!bodyChange && !!changeSet.bodyChange)
      );
    });
    if (matchesStoredChange) continue;

    const now = new Date().toISOString();
    const displayTitle = localTitle || sourceTitle;
    pending.push({
      id: `local-pending-${row.id}-${bodyChange ? "body" : "fields"}`,
      databaseItemId: row.databaseItemId,
      documentId: row.documentId,
      kind:
        bodyChange && fieldChanges.length === 0
          ? "body_update"
          : "field_update",
      direction: "outbound",
      state: "pending_push",
      pushMode: "autosave",
      localOnly: true,
      summary:
        bodyChange && fieldChanges.length === 0
          ? `Pending local Builder CMS body change for "${displayTitle}".`
          : fieldChanges.length === 1 &&
              fieldChanges[0]?.localFieldKey === "title"
            ? `Pending local Builder CMS title change for "${localTitle}".`
            : `Pending local Builder CMS changes for "${displayTitle}".`,
      fieldChanges,
      bodyChange,
      riskLevel: "low",
      riskReasons: bodyChange ? ["body diff"] : ["single field diff"],
      conflictState: "none",
      reviewEvents: [],
      executions: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  // New-row creates: a local database item NOT linked to a Builder entry (no
  // source row) and with a non-empty title becomes a create_draft change-set.
  // No baseline comparison here — we send the local values; the create_draft
  // effect (derived from a null target entryId) writes the entry as a draft.
  if (args.databaseItems && args.databaseItems.length > 0) {
    const linkedDocumentIds = new Set(
      args.rowRows.map((row) => row.documentId),
    );
    const documentIdsWithStoredChange = new Set(
      args.storedChangeSets
        .filter(
          (changeSet) =>
            changeSet.direction === "outbound" &&
            changeSet.state !== "applied" &&
            changeSet.state !== "rejected",
        )
        .map((changeSet) => changeSet.documentId),
    );
    const allowUnsourcedCreates = args.allowUnsourcedCreates ?? true;
    for (const item of args.databaseItems) {
      if (linkedDocumentIds.has(item.documentId)) continue;
      if (args.sourceImportedDocumentIds?.has(item.documentId)) continue;
      // Owned by another collection's row identity — not this source's to create.
      if (args.otherSourceDocumentIds?.has(item.documentId)) continue;
      const taggedSourceId = args.taggedSourceByDocumentId?.get(
        item.documentId,
      );
      if (taggedSourceId) {
        // Explicitly tagged for a collection via the "Source" property: only
        // that collection adopts it (regardless of primary/non-primary).
        if (taggedSourceId !== args.source.id) continue;
      } else if (!allowUnsourcedCreates) {
        // Untagged / "Local": only the primary adopts it as a create; other
        // collections leave it alone until it's explicitly assigned to them.
        continue;
      }
      if (documentIdsWithStoredChange.has(item.documentId)) continue;
      const title = args.documentTitleById.get(item.documentId)?.trim() ?? "";
      if (!title) continue;
      const localValues = args.localValuesByDocument?.get(item.documentId);
      const bodyChange =
        args.bodyChangeByDocumentId?.get(item.documentId) ?? null;
      const fieldChanges: ContentDatabaseSourceFieldChange[] = [
        {
          propertyId: null,
          propertyName: "Title",
          localFieldKey: "title",
          sourceFieldKey: "data.title",
          currentValue: null,
          proposedValue: title,
        },
      ];
      for (const field of args.writableFields ?? []) {
        if (!localValues?.has(field.localFieldKey)) continue;
        fieldChanges.push({
          propertyId: field.propertyId,
          propertyName: field.sourceFieldLabel,
          localFieldKey: field.localFieldKey,
          sourceFieldKey: field.sourceFieldKey,
          currentValue: null,
          proposedValue: (localValues.get(field.localFieldKey) ??
            null) as DocumentPropertyValue,
        });
      }
      const now = new Date().toISOString();
      pending.push({
        id: `local-pending-create-${item.databaseItemId}`,
        databaseItemId: item.databaseItemId,
        documentId: item.documentId,
        kind: "field_update",
        direction: "outbound",
        state: "pending_push",
        pushMode: "autosave",
        localOnly: true,
        summary: `Pending new Builder entry "${title}".`,
        fieldChanges,
        bodyChange,
        riskLevel: "low",
        riskReasons: bodyChange
          ? ["new Builder entry (create as draft)", "body diff"]
          : ["new Builder entry (create as draft)"],
        conflictState: "none",
        reviewEvents: [],
        executions: [],
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return pending;
}

export async function resolveDatabaseForSourceMutation(args: {
  databaseId?: string;
  documentId?: string;
}) {
  const db = getDb();
  if (args.databaseId) {
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, args.databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    return database ?? null;
  }
  if (args.documentId) {
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.documentId, args.documentId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    return database ?? null;
  }
  return null;
}

export async function getContentDatabaseSourceSnapshot(
  database: ContentDatabaseRow | ContentDatabase,
): Promise<ContentDatabaseSource | null> {
  if ("deletedAt" in database && database.deletedAt) {
    throw new Error(`Database "${database.id}" not found`);
  }
  const db = getDb();
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, database.id))
    .orderBy(
      asc(schema.contentDatabaseSources.createdAt),
      asc(schema.contentDatabaseSources.id),
    );
  if (!source) return null;
  return loadSourceSnapshot(source, database, {
    includeHeavyBuilderBodyValues: false,
  });
}

/**
 * Load one specific attached source by id (scoped to the database). Multi-source
 * write paths use this so an action can target a non-primary source; single-source
 * callers keep using {@link getContentDatabaseSourceSnapshot} (the primary).
 */
export async function getContentDatabaseSourceSnapshotById(
  database: ContentDatabaseRow | ContentDatabase,
  sourceId: string,
): Promise<ContentDatabaseSource | null> {
  const db = getDb();
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, database.id),
        eq(schema.contentDatabaseSources.id, sourceId),
      ),
    );
  if (!source) return null;
  return loadSourceSnapshot(source, database, {
    includeHeavyBuilderBodyValues: false,
  });
}

/**
 * Resolve the source an action should operate on: the explicit `sourceId` when
 * given (multi-source), otherwise the primary (back-compat single-source). The
 * default path is byte-for-byte the old behavior, so existing callers that omit
 * `sourceId` are unaffected.
 */
export async function getContentDatabaseSourceSnapshotForWrite(
  database: ContentDatabaseRow | ContentDatabase,
  sourceId?: string | null,
): Promise<ContentDatabaseSource | null> {
  const db = getDb();
  if (sourceId) {
    const [source] = await db
      .select()
      .from(schema.contentDatabaseSources)
      .where(
        and(
          eq(schema.contentDatabaseSources.id, sourceId),
          eq(schema.contentDatabaseSources.databaseId, database.id),
        ),
      );
    return source
      ? loadSourceSnapshot(source, database, {
          includeHeavyBuilderBodyValues: true,
        })
      : null;
  }
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, database.id))
    .orderBy(
      asc(schema.contentDatabaseSources.createdAt),
      asc(schema.contentDatabaseSources.id),
    );
  return source
    ? loadSourceSnapshot(source, database, {
        includeHeavyBuilderBodyValues: true,
      })
    : null;
}

/**
 * Load every source attached to a database (oldest first → `[0]` is the
 * primary). Federation joins read this; single-source callers keep using
 * `getContentDatabaseSourceSnapshot`, which returns the primary.
 */
export async function getAllContentDatabaseSourceSnapshots(
  database: ContentDatabaseRow | ContentDatabase,
): Promise<ContentDatabaseSource[]> {
  if ("deletedAt" in database && database.deletedAt) {
    throw new Error(`Database "${database.id}" not found`);
  }
  const db = getDb();
  const sources = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, database.id))
    .orderBy(
      asc(schema.contentDatabaseSources.createdAt),
      asc(schema.contentDatabaseSources.id),
    );
  const snapshots: ContentDatabaseSource[] = [];
  for (const source of sources) {
    snapshots.push(
      await loadSourceSnapshot(source, database, {
        includeHeavyBuilderBodyValues: false,
      }),
    );
  }
  return snapshots;
}

async function readSourceSnapshotRowsOnce(args: {
  source: ContentDatabaseSourceRowDb;
  database: ContentDatabaseRow | ContentDatabase;
  isBuilderSource: boolean;
  includeHeavyBuilderBodyValues: boolean;
}) {
  const db = getDb();
  const rowRows = await db
    .select(
      sourceSnapshotRowSelection({
        stripHeavyBuilderBodyValues:
          args.isBuilderSource && !args.includeHeavyBuilderBodyValues,
      }),
    )
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id))
    .orderBy(asc(schema.contentDatabaseSourceRows.createdAt));
  // For Builder sources, load ALL database items (not just synced source rows)
  // so brand-new local rows (no source link) can become create_draft change-sets.
  const databaseItemRows = args.isBuilderSource
    ? await db
        .select({
          id: schema.contentDatabaseItems.id,
          documentId: schema.contentDatabaseItems.documentId,
          bodyHydrationStatus: schema.contentDatabaseItems.bodyHydrationStatus,
        })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, args.database.id),
            eq(schema.contentDatabaseItems.ownerEmail, args.source.ownerEmail),
          ),
        )
    : [];
  const allDocumentIds = Array.from(
    new Set([
      ...rowRows.map((row) => row.documentId),
      ...databaseItemRows.map((item) => item.documentId),
    ]),
  );
  const rowDocuments =
    allDocumentIds.length > 0
      ? await db
          .select({
            id: schema.documents.id,
            title: schema.documents.title,
            content: schema.documents.content,
          })
          .from(schema.documents)
          .where(
            and(
              inArray(schema.documents.id, allDocumentIds),
              eq(schema.documents.ownerEmail, args.source.ownerEmail),
            ),
          )
      : [];
  const propertyValueRows =
    args.isBuilderSource && allDocumentIds.length > 0
      ? await db
          .select({
            documentId: schema.documentPropertyValues.documentId,
            propertyId: schema.documentPropertyValues.propertyId,
            valueJson: schema.documentPropertyValues.valueJson,
          })
          .from(schema.documentPropertyValues)
          .where(
            and(
              inArray(schema.documentPropertyValues.documentId, allDocumentIds),
              eq(
                schema.documentPropertyValues.ownerEmail,
                args.source.ownerEmail,
              ),
            ),
          )
      : [];
  return {
    rowRows,
    databaseItemRows,
    allDocumentIds,
    rowDocuments,
    propertyValueRows,
  };
}

async function sourceSnapshotConsistencyMarker(args: {
  source: ContentDatabaseSourceRowDb;
  database: ContentDatabaseRow | ContentDatabase;
  isBuilderSource: boolean;
  includeHeavyBuilderBodyValues: boolean;
}) {
  const db = getDb();
  const [rows] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      maxUpdatedAt: sql<
        string | null
      >`MAX(${schema.contentDatabaseSourceRows.updatedAt})`,
    })
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));
  const [items] = args.isBuilderSource
    ? await db
        .select({
          count: sql<number>`COUNT(*)`,
          maxUpdatedAt: sql<
            string | null
          >`MAX(${schema.contentDatabaseItems.updatedAt})`,
        })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, args.database.id),
            eq(schema.contentDatabaseItems.ownerEmail, args.source.ownerEmail),
          ),
        )
    : [{ count: 0, maxUpdatedAt: null }];
  return {
    rowCount: Number(rows?.count ?? 0),
    rowMaxUpdatedAt: rows?.maxUpdatedAt ?? null,
    itemCount: Number(items?.count ?? 0),
    itemMaxUpdatedAt: items?.maxUpdatedAt ?? null,
  };
}

function sourceSnapshotConsistencyMarkersEqual(
  left: Awaited<ReturnType<typeof sourceSnapshotConsistencyMarker>>,
  right: Awaited<ReturnType<typeof sourceSnapshotConsistencyMarker>>,
) {
  return (
    left.rowCount === right.rowCount &&
    left.rowMaxUpdatedAt === right.rowMaxUpdatedAt &&
    left.itemCount === right.itemCount &&
    left.itemMaxUpdatedAt === right.itemMaxUpdatedAt
  );
}

async function loadSourceSnapshotRowsOptimistically(args: {
  source: ContentDatabaseSourceRowDb;
  database: ContentDatabaseRow | ContentDatabase;
  isBuilderSource: boolean;
  includeHeavyBuilderBodyValues: boolean;
}) {
  let latest: Awaited<ReturnType<typeof readSourceSnapshotRowsOnce>> | null =
    null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await sourceSnapshotConsistencyMarker(args);
    latest = await readSourceSnapshotRowsOnce(args);
    const after = await sourceSnapshotConsistencyMarker(args);
    if (sourceSnapshotConsistencyMarkersEqual(before, after)) return latest;
  }
  return latest ?? (await readSourceSnapshotRowsOnce(args));
}

async function loadSourceSnapshot(
  source: ContentDatabaseSourceRowDb,
  database: ContentDatabaseRow | ContentDatabase,
  options: { includeHeavyBuilderBodyValues: boolean },
): Promise<ContentDatabaseSource> {
  const db = getDb();
  const [fieldRows, changeRows, reviewRows, executionRows, propertyDefs] =
    await Promise.all([
      db
        .select()
        .from(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.sourceId, source.id))
        .orderBy(asc(schema.contentDatabaseSourceFields.createdAt)),
      db
        .select()
        .from(schema.contentDatabaseSourceChangeSets)
        .where(eq(schema.contentDatabaseSourceChangeSets.sourceId, source.id))
        .orderBy(asc(schema.contentDatabaseSourceChangeSets.createdAt)),
      db
        .select()
        .from(schema.contentDatabaseSourceChangeReviews)
        .where(
          eq(schema.contentDatabaseSourceChangeReviews.sourceId, source.id),
        )
        .orderBy(asc(schema.contentDatabaseSourceChangeReviews.createdAt)),
      db
        .select()
        .from(schema.contentDatabaseSourceExecutions)
        .where(eq(schema.contentDatabaseSourceExecutions.sourceId, source.id))
        .orderBy(asc(schema.contentDatabaseSourceExecutions.createdAt)),
      db
        .select({
          id: schema.documentPropertyDefinitions.id,
          name: schema.documentPropertyDefinitions.name,
          type: schema.documentPropertyDefinitions.type,
          optionsJson: schema.documentPropertyDefinitions.optionsJson,
        })
        .from(schema.documentPropertyDefinitions)
        .where(eq(schema.documentPropertyDefinitions.databaseId, database.id)),
    ]);

  const propertyNameById = new Map(
    propertyDefs.map((row) => [row.id, row.name]),
  );
  const propertyTypeById = new Map(
    propertyDefs.map((row) => [
      row.id,
      row.type as DocumentProperty["definition"]["type"],
    ]),
  );
  const propertyOptionsById = new Map(
    propertyDefs.map((row) => [row.id, parsePropertyOptions(row.optionsJson)]),
  );
  const fields = fieldRows.map((row) =>
    serializeSourceField(
      row,
      row.propertyId ? (propertyNameById.get(row.propertyId) ?? null) : null,
    ),
  );
  const storedChangeSets = changeRows.map(serializeSourceChangeSet);
  const reviewEventsByChangeSetId = new Map<
    string,
    ContentDatabaseSourceReviewEvent[]
  >();
  for (const row of reviewRows) {
    const events = reviewEventsByChangeSetId.get(row.changeSetId) ?? [];
    events.push(serializeReviewEvent(row));
    reviewEventsByChangeSetId.set(row.changeSetId, events);
  }
  const executionsByChangeSetId = new Map<
    string,
    ContentDatabaseSourceExecution[]
  >();
  for (const row of executionRows) {
    const executions = executionsByChangeSetId.get(row.changeSetId) ?? [];
    executions.push(serializeExecution(row));
    executionsByChangeSetId.set(row.changeSetId, executions);
  }
  const isBuilderSource =
    normalizeSourceType(source.sourceType) === "builder-cms";
  const {
    rowRows,
    databaseItemRows,
    allDocumentIds,
    rowDocuments,
    propertyValueRows,
  } = await loadSourceSnapshotRowsOptimistically({
    source,
    database,
    isBuilderSource,
    includeHeavyBuilderBodyValues: options.includeHeavyBuilderBodyValues,
  });
  const rows = rowRows.map((row) =>
    serializeSourceRowRecord(row, {
      includeHeavyBuilderBodyValues: options.includeHeavyBuilderBodyValues,
    }),
  );
  const documentTitleById = new Map(
    rowDocuments.map((document) => [document.id, document.title]),
  );
  const documentContentById = new Map(
    rowDocuments.map((document) => [document.id, document.content]),
  );
  const localValuesByDocument = new Map<string, Map<string, unknown>>();
  for (const valueRow of propertyValueRows) {
    let byField = localValuesByDocument.get(valueRow.documentId);
    if (!byField) {
      byField = new Map<string, unknown>();
      localValuesByDocument.set(valueRow.documentId, byField);
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(valueRow.valueJson);
    } catch {
      parsed = null;
    }
    byField.set(valueRow.propertyId, parsed);
  }
  const writableFields = fieldRows
    .filter((row) => row.mappingType === "property")
    .map((row) => ({
      propertyId: row.propertyId ?? null,
      localFieldKey: row.localFieldKey,
      sourceFieldKey: row.sourceFieldKey,
      sourceFieldLabel: row.sourceFieldLabel,
      propertyType: row.propertyId
        ? (propertyTypeById.get(row.propertyId) ?? null)
        : null,
      propertyOptions: row.propertyId
        ? propertyOptionsById.get(row.propertyId)
        : undefined,
    }));
  // Row-union ownership scoping (Builder only). Determine which documents belong
  // to OTHER sources and whether this source is the primary (oldest), so the
  // create-candidate logic never claims another collection's rows and unsourced
  // "Local" rows only create against the primary. Single-source: no other
  // sources ⇒ empty set, isPrimary ⇒ identical to the old behavior.
  let otherSourceDocumentIds = new Set<string>();
  let isPrimarySource = true;
  let taggedSourceByDocumentId = new Map<string, string>();
  if (isBuilderSource) {
    const dbSources = await db
      .select({
        id: schema.contentDatabaseSources.id,
        sourceName: schema.contentDatabaseSources.sourceName,
      })
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, database.id))
      // Same (createdAt, id) ordering as getExistingSource /
      // getContentDatabaseSourceSnapshot, so "primary" here is definitionally
      // the same source the write path treats as primary — never a different
      // pick on a createdAt tie.
      .orderBy(
        asc(schema.contentDatabaseSources.createdAt),
        asc(schema.contentDatabaseSources.id),
      );
    isPrimarySource = dbSources[0]?.id === source.id;
    const otherSourceIds = dbSources
      .map((row) => row.id)
      .filter((id) => id !== source.id);
    if (otherSourceIds.length > 0) {
      const ownedRows = await db
        .select({ documentId: schema.contentDatabaseSourceRows.documentId })
        .from(schema.contentDatabaseSourceRows)
        .where(
          inArray(schema.contentDatabaseSourceRows.sourceId, otherSourceIds),
        );
      otherSourceDocumentIds = new Set(ownedRows.map((row) => row.documentId));
    }
    // Multi-source: a row's visible "Source" tag value IS its owning source id
    // (the Source option id equals the source id), so adoption is pure id
    // matching — no source-name hop, immune to duplicate names or a "Local"
    // collision. The "Local" sentinel isn't a real source id, so untagged rows
    // fall through to the primary-only path.
    if (dbSources.length > 1) {
      const [sourceProp] = await db
        .select({ id: schema.documentPropertyDefinitions.id })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(schema.documentPropertyDefinitions.databaseId, database.id),
            eq(schema.documentPropertyDefinitions.name, SOURCE_PROPERTY_NAME),
            eq(schema.documentPropertyDefinitions.type, "select"),
          ),
        );
      if (sourceProp) {
        const validSourceIds = new Set(dbSources.map((row) => row.id));
        for (const [documentId, byProperty] of localValuesByDocument) {
          const optionId = byProperty.get(sourceProp.id);
          if (typeof optionId === "string" && validSourceIds.has(optionId)) {
            taggedSourceByDocumentId.set(documentId, optionId);
          }
        }
      }
    }
  }
  const bodyChangeByDocumentId = new Map<
    string,
    ContentDatabaseSourceBodyChange
  >();
  if (isBuilderSource && options.includeHeavyBuilderBodyValues) {
    const sourceRowByDocumentId = new Map(
      rowRows.map((row) => [row.documentId, row]),
    );
    const hydratedDocumentIds = new Set(
      databaseItemRows
        .filter((item) => item.bodyHydrationStatus === "hydrated")
        .map((item) => item.documentId),
    );
    await Promise.all(
      allDocumentIds.map(async (documentId) => {
        if (!hydratedDocumentIds.has(documentId)) return;
        const row = sourceRowByDocumentId.get(documentId);
        if (!row) return;
        const bodyChange = await builderBodyChangeForLocalContent({
          row,
          localContent: documentContentById.get(documentId),
        });
        if (bodyChange) bodyChangeByDocumentId.set(documentId, bodyChange);
      }),
    );
  }

  const localOutboundChangeSets = buildBuilderLocalOutboundChangeSets({
    source,
    rowRows,
    documentTitleById,
    storedChangeSets,
    databaseItems: databaseItemRows.map((item) => ({
      databaseItemId: item.id,
      documentId: item.documentId,
    })),
    localValuesByDocument,
    writableFields,
    otherSourceDocumentIds,
    allowUnsourcedCreates: isPrimarySource,
    taggedSourceByDocumentId,
    bodyChangeByDocumentId,
    sourceImportedDocumentIds: new Set(
      rowRows
        .filter((row) => row.provenance === "Builder CMS read adapter")
        .map((row) => row.documentId),
    ),
  });
  const rowByDocumentId = new Map(rowRows.map((row) => [row.documentId, row]));
  const changeSets = [...storedChangeSets, ...localOutboundChangeSets].map(
    (changeSet) =>
      reviewedChangeSet({
        changeSet,
        source,
        rowByDocumentId,
        reviewEvents: reviewEventsByChangeSetId.get(changeSet.id) ?? [],
        executions: executionsByChangeSetId.get(changeSet.id) ?? [],
      }),
  );
  const metadata = parseObject<SourceMetadataRecord>(source.metadataJson) ?? {};
  const normalizedWriteMode =
    metadata.writeMode === "read_only" ||
    metadata.writeMode === "stage_only" ||
    metadata.writeMode === "publish_updates"
      ? metadata.writeMode
      : undefined;
  const capabilities = normalizeCapabilities(source.capabilitiesJson);
  if (normalizedWriteMode) {
    capabilities.liveWritesEnabled = normalizedWriteMode !== "read_only";
  }

  // A local-table source shows the target database's *live* title, so renaming
  // the underlying table is reflected here instead of the name frozen at attach.
  let displaySourceName = source.sourceName;
  if (normalizeSourceType(source.sourceType) === "local-table") {
    const [target] = await db
      .select({ title: schema.contentDatabases.title })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, source.sourceTable));
    if (target?.title) displaySourceName = target.title;
  }

  const bodyHydration = isBuilderSource
    ? await sourceBodyHydrationSummary({
        sourceId: source.id,
        databaseId: database.id,
      })
    : undefined;

  return {
    id: source.id,
    databaseId: source.databaseId,
    sourceType: normalizeSourceType(source.sourceType),
    sourceName: displaySourceName,
    sourceTable: source.sourceTable,
    syncState: normalizeSourceSyncState(source.syncState),
    freshness: normalizeSourceFreshness(source.freshness),
    lastRefreshedAt: source.lastRefreshedAt,
    lastSourceUpdatedAt: source.lastSourceUpdatedAt,
    lastError: source.lastError,
    capabilities,
    metadata: {
      primaryKey: metadata.primaryKey ?? "id",
      titleField: metadata.titleField ?? "title",
      naturalKeyField: metadata.naturalKeyField ?? null,
      pushMode: metadata.pushMode ?? "none",
      pushModeLabel: metadata.pushModeLabel ?? null,
      pushModeDescription: metadata.pushModeDescription ?? null,
      writeMode: normalizedWriteMode,
      allowPublicationTransitions:
        metadata.allowPublicationTransitions === true,
      notes: metadata.notes ?? null,
      readMode: metadata.readMode ?? null,
      liveReadConfigured: metadata.liveReadConfigured === true,
      lastReadEntryCount:
        typeof metadata.lastReadEntryCount === "number"
          ? metadata.lastReadEntryCount
          : undefined,
      lastReadMatchedRowCount:
        typeof metadata.lastReadMatchedRowCount === "number"
          ? metadata.lastReadMatchedRowCount
          : undefined,
      lastReadLimit:
        typeof metadata.lastReadLimit === "number"
          ? metadata.lastReadLimit
          : undefined,
      lastReadFetchedEntryCount:
        typeof metadata.lastReadFetchedEntryCount === "number"
          ? metadata.lastReadFetchedEntryCount
          : undefined,
      lastReadPartial:
        typeof metadata.lastReadPartial === "boolean"
          ? metadata.lastReadPartial
          : undefined,
      lastReadHasMore:
        typeof metadata.lastReadHasMore === "boolean"
          ? metadata.lastReadHasMore
          : undefined,
      lastReadNextOffset:
        typeof metadata.lastReadNextOffset === "number"
          ? metadata.lastReadNextOffset
          : undefined,
      lastReadSuspiciousEmpty:
        typeof metadata.lastReadSuspiciousEmpty === "boolean"
          ? metadata.lastReadSuspiciousEmpty
          : undefined,
      sourceFetchState:
        metadata.sourceFetchState === "idle" ||
        metadata.sourceFetchState === "fetching" ||
        metadata.sourceFetchState === "error"
          ? metadata.sourceFetchState
          : undefined,
      allowDraftWrites: metadata.allowDraftWrites === true,
      allowPublishWrites: metadata.allowPublishWrites === true,
      allowedWriteModes: Array.isArray(metadata.allowedWriteModes)
        ? metadata.allowedWriteModes
            .map((mode) => normalizePushMode(mode))
            .filter((mode): mode is ContentDatabaseSourcePushMode => !!mode)
        : undefined,
      federation: normalizeSourceFederation(metadata.federation),
    },
    fields,
    rows,
    changeSets,
    bodyHydration,
  };
}

async function sourceBodyHydrationSummary(args: {
  sourceId: string;
  databaseId: string;
}): Promise<ContentDatabaseBodyHydrationSummary> {
  const rows = await getDb()
    .select({
      status: schema.contentDatabaseItems.bodyHydrationStatus,
      queueId: schema.contentDatabaseBodyHydrationQueue.id,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabaseSourceRows,
      eq(
        schema.contentDatabaseSourceRows.databaseItemId,
        schema.contentDatabaseItems.id,
      ),
    )
    .leftJoin(
      schema.contentDatabaseBodyHydrationQueue,
      and(
        eq(
          schema.contentDatabaseBodyHydrationQueue.databaseItemId,
          schema.contentDatabaseItems.id,
        ),
        eq(schema.contentDatabaseBodyHydrationQueue.sourceId, args.sourceId),
      ),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, args.databaseId),
        eq(schema.contentDatabaseSourceRows.sourceId, args.sourceId),
      ),
    );
  const summary: ContentDatabaseBodyHydrationSummary = {
    pending: 0,
    hydrating: 0,
    hydrated: 0,
    error: 0,
    total: rows.length,
  };
  for (const row of rows) {
    if (row.status === "pending" || (!row.status && row.queueId)) {
      summary.pending += 1;
    } else if (row.status === "hydrating") summary.hydrating += 1;
    else if (row.status === "error") summary.error += 1;
    else summary.hydrated += 1;
  }
  return summary;
}

// Pass a stored federation block through only when it has the shape the join
// engine relies on; anything malformed degrades to undefined (no federation),
// keeping a single-source database working.
export function normalizeSourceFederation(
  value: ContentDatabaseSourceFederation | null | undefined,
): ContentDatabaseSourceFederation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const role = value.role === "secondary" ? "secondary" : "primary";
  const join = value.join;
  if (!join || typeof join !== "object") return undefined;
  if (typeof join.normalizationFormula !== "string") return undefined;
  const joinFormula = sanitizeNormalizationFormula(join.normalizationFormula);
  if (!joinFormula) return undefined;
  const valueFormula =
    typeof value.normalizationFormula === "string"
      ? (sanitizeNormalizationFormula(value.normalizationFormula) ??
        joinFormula)
      : joinFormula;
  return {
    role,
    keyField: typeof value.keyField === "string" ? value.keyField : "",
    normalizationFormula: valueFormula,
    join: {
      kind: join.kind === "reference" ? "reference" : "identity",
      collection: typeof join.collection === "string" ? join.collection : null,
      localExpr: typeof join.localExpr === "string" ? join.localExpr : "",
      remoteKeyField:
        typeof join.remoteKeyField === "string" ? join.remoteKeyField : "",
      normalizationFormula: joinFormula,
    },
    canonicalKey:
      value.canonicalKey && typeof value.canonicalKey === "object"
        ? {
            propertyId: value.canonicalKey.propertyId ?? null,
            label:
              typeof value.canonicalKey.label === "string"
                ? value.canonicalKey.label
                : "",
            type:
              typeof value.canonicalKey.type === "string"
                ? value.canonicalKey.type
                : "text",
          }
        : undefined,
    columnBindings: Array.isArray(value.columnBindings)
      ? value.columnBindings
      : undefined,
  };
}

export function serializeSourceMetadataRecord(args: {
  sourceType: ContentDatabaseSourceType;
  sourceTable: string;
  builderModelFields?: BuilderCmsModelFieldSummary[];
  existingMetadataJson?: string | null;
}) {
  const isBuilder = args.sourceType === "builder-cms";
  if (isBuilder) {
    const existingMetadata = parseObject<SourceMetadataRecord>(
      args.existingMetadataJson,
    );
    return JSON.stringify({
      ...builderCmsSourceMetadata(args.sourceTable),
      builderModelFields:
        args.builderModelFields ?? existingMetadata?.builderModelFields,
    });
  }
  return JSON.stringify({
    primaryKey: "id",
    titleField: "title",
    naturalKeyField: null,
    pushMode: "none",
    pushModeLabel: "No push",
    pushModeDescription: "Local mock source; no outbound push mode.",
    notes: "Mock local binding for source-aware database development.",
    label: sourceMetadataLabel(args.sourceType, args.sourceTable),
  });
}

export function serializeBuilderCmsSourceReadMetadataRecord(args: {
  sourceTable: string;
  readState: BuilderCmsReadState;
  entryCount: number;
  matchedRowCount: number;
  progress?: BuilderCmsReadProgress;
  sourceFetchState?: "idle" | "fetching" | "error";
  activeReadSourceRowIds?: string[];
  suspiciousEmpty?: boolean;
  builderModelFields?: BuilderCmsModelFieldSummary[];
  existingMetadataJson?: string | null;
}) {
  const existingMetadata = parseObject<SourceMetadataRecord>(
    args.existingMetadataJson,
  );
  return JSON.stringify({
    ...builderCmsSourceMetadata(args.sourceTable),
    builderModelFields:
      args.builderModelFields ?? existingMetadata?.builderModelFields,
    readMode: args.readState === "live" ? "builder-api" : "fixture",
    liveReadConfigured: args.readState === "live",
    lastReadEntryCount: args.entryCount,
    lastReadMatchedRowCount: args.matchedRowCount,
    lastReadLimit: args.progress?.requestedLimit,
    lastReadFetchedEntryCount: args.progress?.fetchedEntryCount,
    lastReadPartial: args.progress?.partial,
    lastReadHasMore: args.progress?.hasMore,
    lastReadNextOffset: args.progress?.nextOffset,
    lastReadSuspiciousEmpty: args.suspiciousEmpty === true,
    activeReadSourceRowIds: args.suspiciousEmpty
      ? []
      : args.activeReadSourceRowIds,
    sourceFetchState:
      args.sourceFetchState ??
      (args.progress?.partial
        ? "fetching"
        : args.readState === "error"
          ? "error"
          : "idle"),
  });
}

export function serializeSourceCapabilitiesRecord(
  overrides: Partial<ContentDatabaseSourceCapabilities> = {},
) {
  return JSON.stringify({
    ...DEFAULT_SOURCE_CAPABILITIES,
    ...overrides,
  });
}

export function sourceCapabilitiesForType(
  sourceType: ContentDatabaseSourceType,
) {
  if (sourceType === "builder-cms") {
    return serializeSourceCapabilitiesRecord({
      canWriteFields: true,
      canWriteBody: true,
      canPush: true,
      canPull: true,
      canPublish: true,
      canStageLocalRevision: true,
      liveWritesEnabled: false,
      readOnlyRefresh: true,
    });
  }
  return serializeSourceCapabilitiesRecord();
}

function slugifySourceField(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

function builderCmsModelFieldLabel(name: string) {
  return (
    name
      .trim()
      .replace(/^data\./, "")
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Builder field"
  );
}

function normalizeBuilderCmsSourceFieldType(type: string) {
  const normalized = type.trim().toLowerCase();
  if (["number", "integer", "float"].includes(normalized)) return "number";
  if (["date", "datetime", "timestamp"].includes(normalized)) {
    return "datetime";
  }
  if (["url", "link"].includes(normalized)) return "url";
  if (["boolean", "bool", "checkbox"].includes(normalized)) return "boolean";
  if (["list", "array", "tags"].includes(normalized)) return "list";
  return normalized || "text";
}

export async function seedMockSourceFields(args: {
  sourceId: string;
  ownerEmail: string;
  sourceType: ContentDatabaseSourceType;
  properties: DocumentProperty[];
  builderModelFields?: BuilderCmsModelFieldSummary[];
  builderSampleEntries?: BuilderCmsSourceEntry[];
  existingFields?: ContentDatabaseSourceFieldRowDb[];
  now: string;
}) {
  const db = getDb();
  const isBuilder = args.sourceType === "builder-cms";
  const existingBuilderFieldByPropertyId = new Map(
    (args.existingFields ?? [])
      .filter((field) => isBuilder && field.propertyId)
      .map((field) => [field.propertyId!, field]),
  );
  const rows = [
    {
      id: crypto.randomUUID(),
      ownerEmail: args.ownerEmail,
      sourceId: args.sourceId,
      propertyId: null,
      localFieldKey: "title",
      sourceFieldKey: isBuilder ? "data.title" : "title",
      sourceFieldLabel: "Title",
      sourceFieldType: "string",
      mappingType: "title",
      writeOwner: isBuilder ? "source" : "local",
      readOnly: 0,
      provenance: "source title",
      freshness: "fresh",
      lastSyncedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    },
    ...(isBuilder
      ? [
          {
            id: crypto.randomUUID(),
            ownerEmail: args.ownerEmail,
            sourceId: args.sourceId,
            propertyId: null,
            localFieldKey: "builder_url",
            sourceFieldKey: "data.url",
            sourceFieldLabel: "Builder URL",
            sourceFieldType: "url",
            mappingType: "system",
            writeOwner: "source",
            readOnly: 1,
            provenance: "Builder natural key",
            freshness: "fresh",
            lastSyncedAt: args.now,
            createdAt: args.now,
            updatedAt: args.now,
          },
        ]
      : []),
    {
      id: crypto.randomUUID(),
      ownerEmail: args.ownerEmail,
      sourceId: args.sourceId,
      propertyId: null,
      localFieldKey: "source_status",
      sourceFieldKey: "sys.sync_state",
      sourceFieldLabel: "Source sync state",
      sourceFieldType: "system",
      mappingType: "system",
      writeOwner: "derived",
      readOnly: 1,
      provenance: "system",
      freshness: "fresh",
      lastSyncedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    },
    {
      id: crypto.randomUUID(),
      ownerEmail: args.ownerEmail,
      sourceId: args.sourceId,
      propertyId: null,
      localFieldKey: "source_updated_at",
      sourceFieldKey: isBuilder ? "lastUpdated" : "sys.updated_at",
      sourceFieldLabel: "Source updated at",
      sourceFieldType: "datetime",
      mappingType: "system",
      writeOwner: "derived",
      readOnly: 1,
      provenance: "system",
      freshness: "fresh",
      lastSyncedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    },
    // The auto-created "Source" property is internal row-tagging (which
    // collection a row belongs to). It must NEVER become a writable Builder
    // source field — otherwise its local option-id value diffs against an
    // absent baseline and every row shows a phantom pending change, and a push
    // would try to write the internal tag to Builder. Match the SAME shape
    // ensureDatabaseSourceProperty uses to identify it (a `select` named
    // "Source") and only for Builder sources, so a user's own field happening
    // to be named "Source" — or any non-Builder/local-table source — is left
    // untouched.
    ...args.properties
      .filter(
        (property) =>
          !(
            isBuilder &&
            property.definition.name === SOURCE_PROPERTY_NAME &&
            property.definition.type === "select"
          ),
      )
      .map((property) => ({
        id: crypto.randomUUID(),
        ownerEmail: args.ownerEmail,
        sourceId: args.sourceId,
        propertyId: property.definition.id,
        localFieldKey: property.definition.id,
        sourceFieldKey: isBuilder
          ? (existingBuilderFieldByPropertyId.get(property.definition.id)
              ?.sourceFieldKey ??
            builderCmsSourceFieldKey(
              property.definition.id,
              property.definition.name,
            ))
          : `fields.${slugifySourceField(property.definition.name)}`,
        sourceFieldLabel: property.definition.name,
        sourceFieldType: property.definition.type,
        mappingType: "property",
        writeOwner:
          property.definition.type === "created_time" ||
          property.definition.type === "created_by" ||
          property.definition.type === "last_edited_time" ||
          property.definition.type === "last_edited_by"
            ? "derived"
            : isBuilder
              ? "source"
              : "local",
        readOnly:
          property.definition.type === "created_time" ||
          property.definition.type === "created_by" ||
          property.definition.type === "last_edited_time" ||
          property.definition.type === "last_edited_by"
            ? 1
            : 0,
        provenance:
          property.definition.type === "formula" ||
          property.definition.type === "rollup"
            ? "derived"
            : "source field",
        freshness: "fresh",
        lastSyncedAt: args.now,
        createdAt: args.now,
        updatedAt: args.now,
      })),
  ];
  const sourceFieldIdentityKey = (sourceFieldKey: string) => {
    const trimmed = sourceFieldKey.trim();
    return isBuilder ? trimmed : trimmed.toLowerCase();
  };
  if (isBuilder) {
    const existingSourceFieldKeys = new Set(
      rows.map((row) => sourceFieldIdentityKey(row.sourceFieldKey)),
    );
    for (const field of args.builderModelFields ?? []) {
      const fieldName = field.name.trim();
      if (!fieldName) continue;
      const sourceFieldKey = `data.${fieldName}`;
      const normalizedKey = sourceFieldIdentityKey(sourceFieldKey);
      if (existingSourceFieldKeys.has(normalizedKey)) continue;
      existingSourceFieldKeys.add(normalizedKey);
      rows.push({
        id: crypto.randomUUID(),
        ownerEmail: args.ownerEmail,
        sourceId: args.sourceId,
        propertyId: null,
        localFieldKey: sourceFieldKey,
        sourceFieldKey,
        sourceFieldLabel: builderCmsModelFieldLabel(fieldName),
        sourceFieldType: normalizeBuilderCmsSourceFieldType(field.type),
        mappingType: "property",
        writeOwner: "source",
        readOnly: 0,
        provenance: "Builder model field",
        freshness: "fresh",
        lastSyncedAt: args.now,
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
    for (const entry of args.builderSampleEntries ?? []) {
      for (const sourceFieldKey of Object.keys(entry.sourceValues)) {
        if (!sourceFieldKey.startsWith("data.")) continue;
        const normalizedKey = sourceFieldIdentityKey(sourceFieldKey);
        if (existingSourceFieldKeys.has(normalizedKey)) continue;
        existingSourceFieldKeys.add(normalizedKey);
        const value = entry.sourceValues[sourceFieldKey];
        rows.push({
          id: crypto.randomUUID(),
          ownerEmail: args.ownerEmail,
          sourceId: args.sourceId,
          propertyId: null,
          localFieldKey: sourceFieldKey,
          sourceFieldKey,
          sourceFieldLabel: builderCmsModelFieldLabel(
            sourceFieldKey.slice("data.".length),
          ),
          sourceFieldType:
            typeof value === "number"
              ? "number"
              : typeof value === "boolean"
                ? "boolean"
                : Array.isArray(value)
                  ? "list"
                  : "text",
          mappingType: "property",
          writeOwner: "source",
          readOnly: 0,
          provenance: "Builder content field",
          freshness: "fresh",
          lastSyncedAt: args.now,
          createdAt: args.now,
          updatedAt: args.now,
        });
      }
    }
  }

  const existingFieldBySourceKey = new Map(
    (args.existingFields ?? []).map((field) => [
      sourceFieldIdentityKey(field.sourceFieldKey),
      field,
    ]),
  );
  const mergedRows = rows.map((row) => {
    const existing = existingFieldBySourceKey.get(
      sourceFieldIdentityKey(row.sourceFieldKey),
    );
    if (!existing) return row;
    return {
      ...row,
      id: existing.id,
      propertyId: existing.propertyId ?? row.propertyId,
      localFieldKey: existing.propertyId
        ? existing.localFieldKey
        : row.localFieldKey,
      mappingType: existing.propertyId ? existing.mappingType : row.mappingType,
      createdAt: existing.createdAt,
    };
  });

  await db.insert(schema.contentDatabaseSourceFields).values(mergedRows);
}

export async function seedMockSourceRows(args: {
  sourceId: string;
  ownerEmail: string;
  sourceType: ContentDatabaseSourceType;
  sourceTable: string;
  items: ContentDatabaseItem[];
  now: string;
  existingBuilderRows?: Map<string, ExistingBuilderSourceRowIdentity>;
  builderEntriesByDocumentId?: Map<string, BuilderCmsSourceEntry>;
}) {
  if (args.items.length === 0) return;
  const db = getDb();
  await db.insert(schema.contentDatabaseSourceRows).values(
    args.items.map((item, index) => {
      const builderEntry = args.builderEntriesByDocumentId?.get(
        item.document.id,
      );
      const existingBuilderRow = args.existingBuilderRows?.get(
        item.document.id,
      );
      const builderIdentity =
        args.sourceType === "builder-cms"
          ? builderCmsSourceRowIdentity({
              item,
              sourceTable: args.sourceTable,
              now: args.now,
              existing: existingBuilderRow,
              entry: builderEntry,
            })
          : null;
      return {
        id: crypto.randomUUID(),
        ownerEmail: args.ownerEmail,
        sourceId: args.sourceId,
        databaseItemId: item.id,
        documentId: item.document.id,
        sourceRowId: builderIdentity
          ? builderIdentity.sourceRowId
          : `${args.sourceType}-${item.document.id}`,
        sourceQualifiedId: builderIdentity
          ? builderIdentity.sourceQualifiedId
          : `${args.sourceType}://${args.sourceTable}/${item.document.id}`,
        sourceDisplayKey:
          builderIdentity?.sourceDisplayKey ??
          item.document.title?.trim() ??
          `${args.sourceType}-${index + 1}`,
        sourceValuesJson: JSON.stringify(
          sourceValuesForSeededSourceRow({
            sourceType: args.sourceType,
            item,
            sourceTable: args.sourceTable,
            now: args.now,
            builderEntry,
            existingSourceValuesJson: existingBuilderRow?.sourceValuesJson,
          }),
        ),
        provenance:
          args.sourceType === "builder-cms"
            ? args.builderEntriesByDocumentId?.has(item.document.id)
              ? "Builder CMS read adapter"
              : BUILDER_CMS_FIXTURE_ROW_PROVENANCE
            : "mock source row",
        syncState: "linked",
        freshness: "fresh",
        lastSyncedAt: args.now,
        lastSourceUpdatedAt: builderIdentity?.lastSourceUpdatedAt ?? args.now,
        createdAt: args.now,
        updatedAt: args.now,
      };
    }),
  );
}

export function sourceValuesForSeededSourceRow(args: {
  sourceType: ContentDatabaseSourceType;
  item: ContentDatabaseItem;
  sourceTable: string;
  now: string;
  builderEntry?: BuilderCmsSourceEntry | null;
  existingSourceValuesJson?: string | null;
}): Record<string, DocumentPropertyValue> {
  const existingSourceValues = parseObject<
    Record<string, DocumentPropertyValue>
  >(args.existingSourceValuesJson);
  if (args.builderEntry?.sourceValues) {
    return builderSourceValuesWithPreservedBodyBaseline({
      incoming: args.builderEntry.sourceValues,
      existing: existingSourceValues,
    });
  }
  if (existingSourceValues) return existingSourceValues;
  if (args.sourceType !== "builder-cms") return {};
  return buildBuilderCmsFixtureEntry({
    item: args.item,
    sourceTable: args.sourceTable,
    now: args.now,
  }).sourceValues;
}

function builderSourceValuesWithPreservedBodyBaseline(args: {
  incoming: Record<string, DocumentPropertyValue>;
  existing?: Record<string, DocumentPropertyValue> | null;
}) {
  const existing = args.existing;
  if (!existing) return args.incoming;
  const incomingContent = stringSourceValue(
    args.incoming,
    BUILDER_CMS_BODY_CONTENT_KEY,
  );
  const existingContent = stringSourceValue(
    existing,
    BUILDER_CMS_BODY_CONTENT_KEY,
  );
  const incomingHash = stringSourceValue(
    args.incoming,
    BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  );
  const existingHash = stringSourceValue(
    existing,
    BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  );
  if (
    incomingContent?.trim() ||
    !existingContent?.trim() ||
    (incomingHash && existingHash && incomingHash !== existingHash)
  ) {
    return args.incoming;
  }

  const next = { ...args.incoming };
  for (const key of [
    BUILDER_CMS_BODY_CONTENT_KEY,
    BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY,
    BUILDER_CMS_BODY_READABLE_MAP_KEY,
    BUILDER_CMS_BODY_SIDECARS_KEY,
    BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  ]) {
    if (next[key] === undefined && existing[key] !== undefined) {
      next[key] = existing[key];
    }
  }
  return next;
}

export async function materializeSourceFieldPropertyValues(args: {
  database: ContentDatabaseRow;
  sourceId: string;
  fields: ContentDatabaseSourceFieldRowDb[];
  documentIds?: string[];
  now: string;
}) {
  const boundFields = args.fields.filter((field) => field.propertyId);
  if (boundFields.length === 0) return;
  const db = getDb();
  const documentIdSet =
    args.documentIds && args.documentIds.length > 0
      ? new Set(args.documentIds)
      : null;
  const propertyIds = Array.from(
    new Set(boundFields.map((field) => field.propertyId!)),
  );
  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(inArray(schema.documentPropertyDefinitions.id, propertyIds));
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const scopedRows: Array<{
    documentId: string;
    sourceValuesJson: string;
  }> = [];
  if (documentIdSet) {
    for (const idChunk of chunks(Array.from(documentIdSet), idChunkSize())) {
      scopedRows.push(
        ...(await db
          .select({
            documentId: schema.contentDatabaseSourceRows.documentId,
            sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
          })
          .from(schema.contentDatabaseSourceRows)
          .where(
            and(
              eq(schema.contentDatabaseSourceRows.sourceId, args.sourceId),
              inArray(schema.contentDatabaseSourceRows.documentId, idChunk),
            ),
          )
          .orderBy(
            asc(schema.contentDatabaseSourceRows.updatedAt),
            asc(schema.contentDatabaseSourceRows.createdAt),
            asc(schema.contentDatabaseSourceRows.id),
          )),
      );
    }
  } else {
    scopedRows.push(
      ...(await db
        .select({
          documentId: schema.contentDatabaseSourceRows.documentId,
          sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
        })
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, args.sourceId))
        .orderBy(
          asc(schema.contentDatabaseSourceRows.updatedAt),
          asc(schema.contentDatabaseSourceRows.createdAt),
          asc(schema.contentDatabaseSourceRows.id),
        )),
    );
  }
  if (scopedRows.length === 0) return;

  const existingValues: Array<
    typeof schema.documentPropertyValues.$inferSelect
  > = [];
  const scopedExistingValueChunkSize = documentIdSet
    ? bulkChunkSizeForColumnCount(2)
    : idChunkSize();
  for (const propertyIdChunk of chunks(
    propertyIds,
    scopedExistingValueChunkSize,
  )) {
    if (documentIdSet) {
      for (const documentIdChunk of chunks(
        Array.from(documentIdSet),
        scopedExistingValueChunkSize,
      )) {
        existingValues.push(
          ...(await db
            .select()
            .from(schema.documentPropertyValues)
            .where(
              and(
                inArray(
                  schema.documentPropertyValues.propertyId,
                  propertyIdChunk,
                ),
                inArray(
                  schema.documentPropertyValues.documentId,
                  documentIdChunk,
                ),
              ),
            )),
        );
      }
    } else {
      existingValues.push(
        ...(await db
          .select()
          .from(schema.documentPropertyValues)
          .where(
            inArray(schema.documentPropertyValues.propertyId, propertyIdChunk),
          )),
      );
    }
  }
  const existingByDocumentAndProperty = new Map(
    existingValues.map((value) => [
      `${value.documentId}\0${value.propertyId}`,
      value,
    ]),
  );
  const upsertsByDocumentAndProperty = new Map<
    string,
    typeof schema.documentPropertyValues.$inferInsert
  >();

  for (const row of scopedRows) {
    const sourceValues =
      parseObject<Record<string, DocumentPropertyValue>>(
        row.sourceValuesJson,
      ) ?? {};
    for (const field of boundFields) {
      const propertyId = field.propertyId!;
      const definition = definitionById.get(propertyId);
      if (!definition) continue;
      const normalized = normalizePropertyValueWithOptions(
        definition.type as DocumentProperty["definition"]["type"],
        sourceValues[field.sourceFieldKey],
        parsePropertyOptions(definition.optionsJson),
      );
      if (normalized === null) continue;
      const valueJson = serializePropertyValue(normalized);
      const key = `${row.documentId}\0${propertyId}`;
      const existing = existingByDocumentAndProperty.get(key);
      if (existing?.valueJson === valueJson) continue;
      upsertsByDocumentAndProperty.set(key, {
        id: existing?.id ?? nanoid(),
        ownerEmail: existing?.ownerEmail ?? args.database.ownerEmail,
        documentId: row.documentId,
        propertyId,
        valueJson,
        createdAt: existing?.createdAt ?? args.now,
        updatedAt: args.now,
      });
    }
  }
  for (const chunk of chunks(
    Array.from(upsertsByDocumentAndProperty.values()),
    bulkChunkSizeForColumnCount(7),
  )) {
    if (chunk.length === 0) continue;
    await db
      .insert(schema.documentPropertyValues)
      .values(chunk)
      .onConflictDoUpdate({
        target: schema.documentPropertyValues.id,
        set: {
          valueJson: sql`excluded.value_json`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

function openChangeSetKey(row: ContentDatabaseSourceChangeSetRowDb) {
  const fields = parseArray<ContentDatabaseSourceFieldChange>(
    row.fieldChangesJson,
  )
    .map((field) => field.propertyId)
    .sort()
    .join(",");
  const hasBodyChange = parseObject<ContentDatabaseSourceBodyChange>(
    row.bodyChangeJson,
  )
    ? "body"
    : "no-body";
  return [
    row.documentId ?? row.databaseItemId ?? "database",
    normalizeChangeDirection(row.direction),
    normalizeChangeKind(row.kind),
    normalizePushMode(row.pushMode) ?? "no-push-mode",
    fields || "no-fields",
    hasBodyChange,
  ].join("|");
}

export function sourceChangeSetSummary(args: {
  itemTitle: string | null | undefined;
  fieldChanges: ContentDatabaseSourceFieldChange[];
  bodyChange: ContentDatabaseSourceBodyChange | null;
}) {
  const title = args.itemTitle?.trim() || "Untitled";
  if (args.bodyChange) {
    return `Review mock source body changes for "${title}".`;
  }
  const fieldNames = args.fieldChanges
    .map((field) => field.propertyName)
    .filter(Boolean)
    .join(", ");
  return `Review mock source field change for "${title}"${
    fieldNames ? ` (${fieldNames})` : ""
  }.`;
}

export function sourceChangeSetKey(args: {
  documentId: string | null;
  databaseItemId: string | null;
  kind: ContentDatabaseSourceChangeKind;
  direction?: ContentDatabaseSourceChangeDirection;
  pushMode?: ContentDatabaseSourcePushMode | null;
  fieldChanges: ContentDatabaseSourceFieldChange[];
  bodyChange: ContentDatabaseSourceBodyChange | null;
}) {
  const fields = args.fieldChanges
    .map((field) => field.propertyId)
    .sort()
    .join(",");
  return [
    args.documentId ?? args.databaseItemId ?? "database",
    args.direction ?? "incoming",
    args.kind,
    args.pushMode ?? "no-push-mode",
    fields || "no-fields",
    args.bodyChange ? "body" : "no-body",
  ].join("|");
}

export async function findOpenSourceChangeSet(args: {
  sourceId: string;
  key: string;
  states?: ContentDatabaseSourceChangeState[];
}) {
  const states = args.states ?? ["proposed"];
  const rows = await getDb()
    .select()
    .from(schema.contentDatabaseSourceChangeSets)
    .where(
      and(
        eq(schema.contentDatabaseSourceChangeSets.sourceId, args.sourceId),
        inArray(schema.contentDatabaseSourceChangeSets.state, states),
      ),
    )
    .orderBy(asc(schema.contentDatabaseSourceChangeSets.createdAt));
  return rows.find((row) => openChangeSetKey(row) === args.key) ?? null;
}

async function deleteSourceChangeSetRecords(args: {
  sourceId: string;
  changeSetIds?: string[];
}) {
  if (args.changeSetIds && args.changeSetIds.length === 0) return;

  const db = getDb();
  const executionWhere = args.changeSetIds
    ? and(
        eq(schema.contentDatabaseSourceExecutions.sourceId, args.sourceId),
        inArray(
          schema.contentDatabaseSourceExecutions.changeSetId,
          args.changeSetIds,
        ),
      )
    : eq(schema.contentDatabaseSourceExecutions.sourceId, args.sourceId);
  const reviewWhere = args.changeSetIds
    ? and(
        eq(schema.contentDatabaseSourceChangeReviews.sourceId, args.sourceId),
        inArray(
          schema.contentDatabaseSourceChangeReviews.changeSetId,
          args.changeSetIds,
        ),
      )
    : eq(schema.contentDatabaseSourceChangeReviews.sourceId, args.sourceId);
  const changeSetWhere = args.changeSetIds
    ? and(
        eq(schema.contentDatabaseSourceChangeSets.sourceId, args.sourceId),
        inArray(schema.contentDatabaseSourceChangeSets.id, args.changeSetIds),
      )
    : eq(schema.contentDatabaseSourceChangeSets.sourceId, args.sourceId);

  await db.delete(schema.contentDatabaseSourceExecutions).where(executionWhere);
  await db.delete(schema.contentDatabaseSourceChangeReviews).where(reviewWhere);
  await db.delete(schema.contentDatabaseSourceChangeSets).where(changeSetWhere);
}

async function pruneDuplicateOpenSourceChangeSets(sourceId: string) {
  const rows = await getDb()
    .select()
    .from(schema.contentDatabaseSourceChangeSets)
    .where(
      and(
        eq(schema.contentDatabaseSourceChangeSets.sourceId, sourceId),
        eq(schema.contentDatabaseSourceChangeSets.state, "proposed"),
      ),
    )
    .orderBy(asc(schema.contentDatabaseSourceChangeSets.createdAt));
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const row of rows) {
    const key = openChangeSetKey(row);
    if (seen.has(key)) duplicateIds.push(row.id);
    else seen.add(key);
  }
  if (duplicateIds.length === 0) return;
  await deleteSourceChangeSetRecords({
    sourceId,
    changeSetIds: duplicateIds,
  });
}

export async function resyncMockSourceSnapshot(args: {
  database: ContentDatabaseRow;
  source: ContentDatabaseSourceRowDb;
  now: string;
}) {
  const { properties, response } = await sourceSetupPayload(args.database.id);
  const db = getDb();

  await db
    .delete(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
  await db
    .delete(schema.contentDatabaseBodyHydrationQueue)
    .where(
      eq(schema.contentDatabaseBodyHydrationQueue.sourceId, args.source.id),
    );
  await db
    .delete(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));

  await seedMockSourceFields({
    sourceId: args.source.id,
    ownerEmail: args.database.ownerEmail,
    sourceType: normalizeSourceType(args.source.sourceType),
    properties,
    now: args.now,
  });
  await seedMockSourceRows({
    sourceId: args.source.id,
    ownerEmail: args.database.ownerEmail,
    sourceType: normalizeSourceType(args.source.sourceType),
    sourceTable: args.source.sourceTable,
    items: response.items,
    now: args.now,
  });

  const currentDocumentIds = new Set(
    response.items.map((item) => item.document.id),
  );
  const currentItemByDocumentId = new Map(
    response.items.map((item) => [item.document.id, item]),
  );
  const proposedChangeSets = await db
    .select()
    .from(schema.contentDatabaseSourceChangeSets)
    .where(
      and(
        eq(schema.contentDatabaseSourceChangeSets.sourceId, args.source.id),
        eq(schema.contentDatabaseSourceChangeSets.state, "proposed"),
      ),
    );
  const orphanIds = proposedChangeSets
    .filter((row) => row.documentId && !currentDocumentIds.has(row.documentId))
    .map((row) => row.id);
  if (orphanIds.length > 0) {
    await deleteSourceChangeSetRecords({
      sourceId: args.source.id,
      changeSetIds: orphanIds,
    });
  }

  for (const row of proposedChangeSets) {
    if (orphanIds.includes(row.id)) continue;
    const item = row.documentId
      ? currentItemByDocumentId.get(row.documentId)
      : null;
    if (!item) continue;
    const summary = sourceChangeSetSummary({
      itemTitle: item.document.title,
      fieldChanges: parseArray<ContentDatabaseSourceFieldChange>(
        row.fieldChangesJson,
      ),
      bodyChange: parseObject<ContentDatabaseSourceBodyChange>(
        row.bodyChangeJson,
      ),
    });
    if (summary === row.summary) continue;
    await db
      .update(schema.contentDatabaseSourceChangeSets)
      .set({ summary })
      .where(eq(schema.contentDatabaseSourceChangeSets.id, row.id));
  }
  await pruneDuplicateOpenSourceChangeSets(args.source.id);

  await db
    .update(schema.contentDatabaseSources)
    .set({
      syncState: "idle",
      freshness: "fresh",
      capabilitiesJson: sourceCapabilitiesForType(
        normalizeSourceType(args.source.sourceType),
      ),
      metadataJson: serializeSourceMetadataRecord({
        sourceType: normalizeSourceType(args.source.sourceType),
        sourceTable: args.source.sourceTable,
        existingMetadataJson: args.source.metadataJson,
      }),
      lastRefreshedAt: args.now,
      lastSourceUpdatedAt: args.now,
      lastError: null,
      updatedAt: args.now,
    })
    .where(eq(schema.contentDatabaseSources.id, args.source.id));
}

export function mapBuilderCmsEntriesToLocalItems(args: {
  entries: BuilderCmsSourceEntry[];
  items: ContentDatabaseItem[];
  sourceTable: string;
  now: string;
  existingRows: ContentDatabaseSourceRecordRowDb[];
}) {
  const entriesById = new Map(args.entries.map((entry) => [entry.id, entry]));
  const entriesByQualifiedId = new Map(
    args.entries.map((entry) => [
      builderCmsQualifiedId({
        sourceTable: args.sourceTable,
        entryId: entry.id,
      }),
      entry,
    ]),
  );
  const entriesByUrlPath = uniqueBuilderEntryLookup(
    args.entries,
    (entry) => entry.urlPath.trim().toLowerCase() || null,
  );
  const entriesByTitle = uniqueBuilderEntryLookup(
    args.entries,
    (entry) => entry.title.trim().toLowerCase() || null,
  );
  const existingRowsByDocumentId = new Map(
    args.existingRows.map((row) => [row.documentId, row]),
  );
  const entriesByDocumentId = new Map<string, BuilderCmsSourceEntry>();

  for (const item of args.items) {
    const existing = existingRowsByDocumentId.get(item.document.id);
    const fixtureEntry = buildBuilderCmsFixtureEntry({
      item,
      sourceTable: args.sourceTable,
      now: args.now,
    });
    const match =
      (existing
        ? (entriesById.get(existing.sourceRowId) ??
          entriesByQualifiedId.get(existing.sourceQualifiedId))
        : null) ??
      entriesByUrlPath.get(fixtureEntry.urlPath.toLowerCase()) ??
      entriesByTitle.get(item.document.title.trim().toLowerCase());
    if (match) entriesByDocumentId.set(item.document.id, match);
  }

  return entriesByDocumentId;
}

function uniqueBuilderEntryLookup(
  entries: BuilderCmsSourceEntry[],
  keyForEntry: (entry: BuilderCmsSourceEntry) => string | null,
) {
  const unique = new Map<string, BuilderCmsSourceEntry>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    const key = keyForEntry(entry);
    if (!key || duplicates.has(key)) continue;
    if (unique.has(key)) {
      unique.delete(key);
      duplicates.add(key);
      continue;
    }
    unique.set(key, entry);
  }
  return unique;
}

export function builderCmsEntryAlreadyRepresented(args: {
  entry: BuilderCmsSourceEntry;
  sourceTable: string;
  existingSourceRows: (Pick<
    ContentDatabaseSourceRecordRowDb,
    "sourceQualifiedId"
  > &
    Partial<
      Pick<
        ContentDatabaseSourceRecordRowDb,
        "documentId" | "sourceRowId" | "provenance"
      >
    >)[];
}) {
  const sourceQualifiedId = builderCmsQualifiedId({
    sourceTable: args.sourceTable,
    entryId: args.entry.id,
  });
  return args.existingSourceRows.some((row) => {
    return (
      row.sourceQualifiedId === sourceQualifiedId ||
      row.sourceRowId === args.entry.id
    );
  });
}

export async function importBuilderCmsEntriesAsDatabaseItems(args: {
  database: ContentDatabaseRow;
  entries: BuilderCmsSourceEntry[];
  now: string;
  sourceTable: string;
  existingSourceRows?: ContentDatabaseSourceRecordRowDb[];
  // When importing an ADDITIONAL source (row-union), two collections may share
  // a title legitimately, so the cross-database title dedup must be skipped —
  // per-source re-import idempotency is still handled by
  // builderCmsEntryAlreadyRepresented (existingSourceRows).
  skipTitleDedup?: boolean;
}): Promise<{
  imported: number;
  importedEntriesByDocumentId: Map<string, BuilderCmsSourceEntry>;
}> {
  const importedEntriesByDocumentId = new Map<string, BuilderCmsSourceEntry>();
  if (args.entries.length === 0) {
    return { imported: 0, importedEntriesByDocumentId };
  }
  const db = getDb();
  const [databaseDocument] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, args.database.documentId));
  const currentItems = await db
    .select({
      item: schema.contentDatabaseItems,
      document: schema.documents,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, args.database.id));
  const existingTitles = new Set(
    currentItems.map((row) => row.document.title.trim().toLowerCase()),
  );
  const [maxDocPos] = await db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.ownerEmail, args.database.ownerEmail),
        eq(schema.documents.parentId, args.database.documentId),
      ),
    );
  const [maxItemPos] = await db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, args.database.id));

  let nextDocPosition = (maxDocPos?.max ?? -1) + 1;
  let nextItemPosition = (maxItemPos?.max ?? -1) + 1;
  const documentRows: (typeof schema.documents.$inferInsert)[] = [];
  const itemRows: (typeof schema.contentDatabaseItems.$inferInsert)[] = [];

  for (const entry of args.entries) {
    if (
      builderCmsEntryAlreadyRepresented({
        entry,
        sourceTable: args.sourceTable,
        existingSourceRows: args.existingSourceRows ?? [],
      })
    ) {
      continue;
    }

    const title = entry.title.trim() || entry.id;
    const titleKey = title.toLowerCase();
    if (!args.skipTitleDedup && existingTitles.has(titleKey)) continue;
    existingTitles.add(titleKey);

    const documentId = nanoid();
    const itemId = nanoid();
    documentRows.push({
      id: documentId,
      ownerEmail: args.database.ownerEmail,
      orgId: args.database.orgId,
      parentId: args.database.documentId,
      title,
      content: "",
      icon: null,
      position: nextDocPosition++,
      isFavorite: 0,
      hideFromSearch: databaseDocument?.hideFromSearch ?? 0,
      visibility: databaseDocument?.visibility ?? "private",
      createdAt: args.now,
      updatedAt: args.now,
    });
    itemRows.push({
      id: itemId,
      ownerEmail: args.database.ownerEmail,
      orgId: args.database.orgId,
      databaseId: args.database.id,
      documentId,
      position: nextItemPosition++,
      bodyHydrationStatus: "pending",
      bodyHydrationError: null,
      createdAt: args.now,
      updatedAt: args.now,
    });
    importedEntriesByDocumentId.set(documentId, entry);
  }
  await db.transaction(async (tx) => {
    for (const chunk of chunks(documentRows, bulkChunkSizeForColumnCount(13))) {
      await tx.insert(schema.documents).values(chunk);
    }
    for (const chunk of chunks(itemRows, bulkChunkSizeForColumnCount(10))) {
      await tx.insert(schema.contentDatabaseItems).values(chunk);
    }
  });

  return { imported: itemRows.length, importedEntriesByDocumentId };
}

export async function resyncBuilderCmsSourceSnapshot(args: {
  database: ContentDatabaseRow;
  source: ContentDatabaseSourceRowDb;
  now: string;
  runFullRefresh?: boolean;
}) {
  let { properties, response } = await sourceSetupPayload(args.database.id);
  const db = getDb();
  const sourceMetadata =
    parseObject<SourceMetadataRecord>(args.source.metadataJson) ?? {};
  const activeReadSourceRowIds =
    Array.isArray(sourceMetadata.activeReadSourceRowIds) &&
    sourceMetadata.activeReadSourceRowIds.every((id) => typeof id === "string")
      ? sourceMetadata.activeReadSourceRowIds
      : [];
  const continueOffset =
    !args.runFullRefresh &&
    sourceMetadata.sourceFetchState === "fetching" &&
    sourceMetadata.lastReadHasMore === true &&
    activeReadSourceRowIds.length > 0 &&
    typeof sourceMetadata.lastReadNextOffset === "number" &&
    sourceMetadata.lastReadNextOffset > 0
      ? sourceMetadata.lastReadNextOffset
      : 0;
  const existingFields = await db
    .select()
    .from(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
  let builderModelFields: BuilderCmsModelFieldSummary[] | undefined;
  let builderModelFieldsReadFailed = false;
  try {
    builderModelFields = await readBuilderCmsModelFields({
      model: args.source.sourceTable,
    });
  } catch (error) {
    builderModelFieldsReadFailed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[content] Builder model field read failed for ${args.source.sourceTable}; continuing source row sync without model field metadata. ${message}`,
    );
  }
  const projectionModelFields =
    builderModelFields && builderModelFields.length > 0
      ? builderModelFields
      : (sourceMetadata.builderModelFields ?? []);
  const builderRead = await readBuilderCmsContentEntries({
    model: args.source.sourceTable,
    fieldPaths: [
      ...existingFields.map((field) => field.sourceFieldKey),
      ...projectionModelFields.map((field) => `data.${field.name}`),
    ],
    maxPages: args.runFullRefresh
      ? undefined
      : BUILDER_CMS_REFRESH_INITIAL_PAGES,
    limit: args.runFullRefresh ? 10_000 : undefined,
    offset: continueOffset,
  });
  const incrementalRead =
    builderRead.state === "live" &&
    (builderRead.progress?.partial === true ||
      (builderRead.progress?.startOffset ?? 0) > 0);
  const builderEntries =
    builderRead.state === "live" ? builderRead.entries : [];
  let existingRows = await db
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));
  const readStartOffset = builderRead.progress?.startOffset ?? 0;
  const activeReadSourceRowIdSet = new Set(activeReadSourceRowIds);
  const suspiciousEmptyRead =
    builderRead.state === "live" &&
    builderRead.entries.length === 0 &&
    existingRows.length > 0 &&
    (readStartOffset === 0 ||
      existingRows.some(
        (row) => !activeReadSourceRowIdSet.has(row.sourceRowId),
      ));
  if (suspiciousEmptyRead) {
    const message =
      "Builder CMS returned no entries for a source with existing rows. The previous snapshot was preserved; retry the refresh before treating the source as empty.";
    await updateBuilderCmsSourceReadMetadata({
      sourceId: args.source.id,
      sourceTable: args.source.sourceTable,
      readState: builderRead.state,
      entryCount: builderRead.entries.length,
      matchedRowCount: 0,
      fetchedAt: builderRead.fetchedAt,
      now: args.now,
      message,
      builderModelFields,
      progress: builderRead.progress,
      sourceFetchState: "error",
      syncState: "error",
      suspiciousEmpty: true,
    });
    return;
  }
  await enqueueEmptyHydratedBuilderBodiesFromStoredRows({
    source: args.source,
    now: args.now,
  });
  let importedEntriesByDocumentId = new Map<string, BuilderCmsSourceEntry>();
  if (builderRead.state === "live") {
    const importResult = await importBuilderCmsEntriesAsDatabaseItems({
      database: args.database,
      entries: builderEntries,
      now: args.now,
      sourceTable: args.source.sourceTable,
      existingSourceRows: existingRows,
    });
    importedEntriesByDocumentId = importResult.importedEntriesByDocumentId;
    if (importResult.imported > 0) {
      ({ properties, response } = await sourceSetupPayload(args.database.id));
      existingRows = await db
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));
    }
  }
  const builderEntriesByDocumentId =
    builderRead.state === "live"
      ? mapBuilderCmsEntriesToLocalItems({
          entries: builderEntries,
          items: response.items,
          sourceTable: args.source.sourceTable,
          now: args.now,
          existingRows,
        })
      : new Map<string, BuilderCmsSourceEntry>();
  for (const [documentId, entry] of importedEntriesByDocumentId) {
    builderEntriesByDocumentId.set(documentId, entry);
  }
  const existingBuilderRows = new Map<string, ExistingBuilderSourceRowIdentity>(
    existingRows.map((row) => [
      row.documentId,
      {
        documentId: row.documentId,
        sourceRowId: row.sourceRowId,
        sourceQualifiedId: row.sourceQualifiedId,
        sourceDisplayKey: row.sourceDisplayKey,
        lastSourceUpdatedAt: row.lastSourceUpdatedAt,
        sourceValuesJson: row.sourceValuesJson,
      },
    ]),
  );

  if (incrementalRead) {
    const currentSourceRowIds = builderEntries.map((entry) => entry.id);
    const nextActiveReadSourceRowIds = Array.from(
      new Set(
        continueOffset > 0
          ? [...activeReadSourceRowIds, ...currentSourceRowIds]
          : currentSourceRowIds,
      ),
    );
    const hasMore = builderRead.progress?.hasMore === true;

    const shouldReseedSourceFields =
      !builderModelFieldsReadFailed || existingFields.length === 0;
    if (shouldReseedSourceFields) {
      await db
        .delete(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
      await seedMockSourceFields({
        sourceId: args.source.id,
        ownerEmail: args.database.ownerEmail,
        sourceType: "builder-cms",
        properties,
        builderModelFields,
        builderSampleEntries: builderEntries,
        existingFields,
        now: args.now,
      });
    }

    const itemsToLink = response.items.filter((item) =>
      builderEntriesByDocumentId.has(item.document.id),
    );
    const fetchedDocumentIds = itemsToLink.map((item) => item.document.id);
    if (fetchedDocumentIds.length > 0) {
      for (const idChunk of chunks(fetchedDocumentIds, idChunkSize())) {
        await db
          .delete(schema.contentDatabaseSourceRows)
          .where(
            and(
              eq(schema.contentDatabaseSourceRows.sourceId, args.source.id),
              inArray(schema.contentDatabaseSourceRows.documentId, idChunk),
            ),
          );
      }
      await seedMockSourceRows({
        sourceId: args.source.id,
        ownerEmail: args.database.ownerEmail,
        sourceType: "builder-cms",
        sourceTable: args.source.sourceTable,
        items: itemsToLink,
        now: args.now,
        existingBuilderRows,
        builderEntriesByDocumentId,
      });
      const refreshedFields = await db
        .select()
        .from(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
      await materializeSourceFieldPropertyValues({
        database: args.database,
        sourceId: args.source.id,
        fields: refreshedFields,
        documentIds: fetchedDocumentIds,
        now: args.now,
      });
      await enqueueBuilderBodyHydrationForItems({
        sourceId: args.source.id,
        ownerEmail: args.database.ownerEmail,
        orgId: args.database.orgId,
        sourceTable: args.source.sourceTable,
        items: itemsToLink,
        builderEntriesByDocumentId,
        now: args.now,
      });
    }
    if (!hasMore && nextActiveReadSourceRowIds.length > 0) {
      const activeSourceRowIds = new Set(nextActiveReadSourceRowIds);
      const staleRows = (
        await db
          .select({
            id: schema.contentDatabaseSourceRows.id,
            sourceRowId: schema.contentDatabaseSourceRows.sourceRowId,
          })
          .from(schema.contentDatabaseSourceRows)
          .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id))
      ).filter((row) => !activeSourceRowIds.has(row.sourceRowId));
      for (const idChunk of chunks(
        staleRows.map((row) => row.id),
        idChunkSize(),
      )) {
        await db
          .delete(schema.contentDatabaseSourceRows)
          .where(inArray(schema.contentDatabaseSourceRows.id, idChunk));
      }
    }

    await updateBuilderCmsSourceReadMetadata({
      sourceId: args.source.id,
      sourceTable: args.source.sourceTable,
      readState: builderRead.state,
      entryCount: builderRead.entries.length,
      matchedRowCount: builderEntriesByDocumentId.size,
      fetchedAt: builderRead.fetchedAt,
      now: args.now,
      message: builderRead.message,
      builderModelFields,
      progress: {
        ...builderRead.progress,
        partial: hasMore,
      },
      sourceFetchState: hasMore ? "fetching" : "idle",
      syncState: hasMore ? "refreshing" : "idle",
      activeReadSourceRowIds: hasMore ? nextActiveReadSourceRowIds : undefined,
    });
    return;
  }

  const shouldReseedSourceFields =
    !builderModelFieldsReadFailed || existingFields.length === 0;
  if (shouldReseedSourceFields) {
    await db
      .delete(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
  }
  await db
    .delete(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));

  if (shouldReseedSourceFields) {
    await seedMockSourceFields({
      sourceId: args.source.id,
      ownerEmail: args.database.ownerEmail,
      sourceType: "builder-cms",
      properties,
      builderModelFields,
      builderSampleEntries: builderEntries,
      existingFields,
      now: args.now,
    });
  }
  // Row-union: a resync must only (re)link items that BELONG to this source —
  // never claim every database item. With a single source, all items belong to
  // it (back-compat). With multiple sources, link only this source's
  // remote-backed rows when the read is live (this self-heals any prior
  // over-claim, since rows are deleted then reseeded); when offline, preserve
  // just the rows already owned so nothing is orphaned. New / "Local" /
  // other-collection rows stay unlinked, so the Source-tag create path can
  // adopt them into the right collection.
  const databaseSourceCount = (
    await db
      .select({ id: schema.contentDatabaseSources.id })
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, args.database.id))
  ).length;
  const itemsToLink =
    databaseSourceCount > 1
      ? response.items.filter((item) =>
          builderRead.state === "live"
            ? builderEntriesByDocumentId.has(item.document.id)
            : existingBuilderRows.has(item.document.id),
        )
      : response.items;
  await seedMockSourceRows({
    sourceId: args.source.id,
    ownerEmail: args.database.ownerEmail,
    sourceType: "builder-cms",
    sourceTable: args.source.sourceTable,
    items: itemsToLink,
    now: args.now,
    existingBuilderRows,
    builderEntriesByDocumentId,
  });
  const refreshedFields = await db
    .select()
    .from(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
  await materializeSourceFieldPropertyValues({
    database: args.database,
    sourceId: args.source.id,
    fields: refreshedFields,
    documentIds: itemsToLink.map((item) => item.document.id),
    now: args.now,
  });
  if (builderRead.state === "live") {
    await enqueueBuilderBodyHydrationForItems({
      sourceId: args.source.id,
      ownerEmail: args.database.ownerEmail,
      orgId: args.database.orgId,
      sourceTable: args.source.sourceTable,
      items: itemsToLink,
      builderEntriesByDocumentId,
      now: args.now,
    });
  }

  const currentDocumentIds = new Set(
    response.items.map((item) => item.document.id),
  );
  const openChangeSets = await db
    .select()
    .from(schema.contentDatabaseSourceChangeSets)
    .where(eq(schema.contentDatabaseSourceChangeSets.sourceId, args.source.id));
  const orphanIds = openChangeSets
    .filter((row) => row.documentId && !currentDocumentIds.has(row.documentId))
    .map((row) => row.id);
  if (orphanIds.length > 0) {
    await deleteSourceChangeSetRecords({
      sourceId: args.source.id,
      changeSetIds: orphanIds,
    });
  }
  await pruneDuplicateOpenSourceChangeSets(args.source.id);

  await updateBuilderCmsSourceReadMetadata({
    sourceId: args.source.id,
    sourceTable: args.source.sourceTable,
    readState: builderRead.state,
    entryCount: builderRead.entries.length,
    matchedRowCount: builderEntriesByDocumentId.size,
    fetchedAt: builderRead.fetchedAt,
    now: args.now,
    message: builderRead.message,
    builderModelFields,
    progress: builderRead.progress,
    sourceFetchState: builderRead.state === "error" ? "error" : "idle",
    activeReadSourceRowIds: undefined,
    syncState: "idle",
  });
}

function valueText(value: DocumentPropertyValue) {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.join(", ") || "empty";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function buildMockFieldChange(args: {
  property: DocumentProperty;
  currentValue: DocumentPropertyValue;
}): ContentDatabaseSourceFieldChange {
  const property = args.property;
  return {
    propertyId: property.definition.id,
    propertyName: property.definition.name,
    localFieldKey: property.definition.id,
    sourceFieldKey: `fields.${slugifySourceField(property.definition.name)}`,
    currentValue: args.currentValue,
    proposedValue: mockProposedValue(property, args.currentValue),
  };
}

export function mockProposedValue(
  property: DocumentProperty,
  currentValue: DocumentPropertyValue,
): DocumentPropertyValue {
  switch (property.definition.type) {
    case "number":
      return typeof currentValue === "number" ? currentValue + 1 : 1;
    case "checkbox":
      return currentValue === true ? false : true;
    case "multi_select":
      return Array.isArray(currentValue)
        ? [...currentValue, "mock-source"]
        : ["mock-source"];
    case "date":
      return currentValue || new Date().toISOString().slice(0, 10);
    default:
      return `${valueText(currentValue)} (mock source update)`;
  }
}

export function buildMockBodyChange(
  currentContent: string,
): ContentDatabaseSourceBodyChange {
  const excerpt = currentContent.trim().slice(0, 140) || null;
  return {
    summary: "Mock body diff for review-only Phase 1 verification.",
    currentExcerpt: excerpt,
    proposedExcerpt: excerpt
      ? `${excerpt}\n\n[Mock source proposed paragraph]`
      : "[Mock source proposed paragraph]",
  };
}

export async function replaceSourceMetadata(args: {
  database: ContentDatabaseRow;
  source: ContentDatabaseSourceRowDb | null;
  sourceType: ContentDatabaseSourceType;
  sourceName: string;
  sourceTable: string;
  now: string;
}) {
  const db = getDb();
  const sourceId = args.source?.id ?? crypto.randomUUID();

  if (args.source) {
    await deleteSourceChangeSetRecords({ sourceId: args.source.id });
    await db
      .delete(schema.contentDatabaseBodyHydrationQueue)
      .where(
        eq(schema.contentDatabaseBodyHydrationQueue.sourceId, args.source.id),
      );
    await db
      .delete(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
    await db
      .delete(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));
  }

  if (args.source) {
    await db
      .update(schema.contentDatabaseSources)
      .set({
        sourceType: args.sourceType,
        sourceName: args.sourceName,
        sourceTable: args.sourceTable,
        syncState: "linked",
        freshness: "fresh",
        capabilitiesJson: sourceCapabilitiesForType(args.sourceType),
        metadataJson: serializeSourceMetadataRecord({
          sourceType: args.sourceType,
          sourceTable: args.sourceTable,
          existingMetadataJson:
            args.source.sourceType === args.sourceType &&
            args.source.sourceTable === args.sourceTable
              ? args.source.metadataJson
              : null,
        }),
        lastRefreshedAt: args.now,
        lastSourceUpdatedAt: args.now,
        lastError: null,
        updatedAt: args.now,
      })
      .where(eq(schema.contentDatabaseSources.id, args.source.id));
  } else {
    await db.insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: args.database.ownerEmail,
      orgId: args.database.orgId,
      databaseId: args.database.id,
      sourceType: args.sourceType,
      sourceName: args.sourceName,
      sourceTable: args.sourceTable,
      syncState: "linked",
      freshness: "fresh",
      capabilitiesJson: sourceCapabilitiesForType(args.sourceType),
      metadataJson: serializeSourceMetadataRecord({
        sourceType: args.sourceType,
        sourceTable: args.sourceTable,
      }),
      lastRefreshedAt: args.now,
      lastSourceUpdatedAt: args.now,
      lastError: null,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }

  return sourceId;
}

/**
 * Insert an ADDITIONAL source without touching existing sources — the primary
 * keeps its fields and rows. Used to federate a read-only second source.
 */
export async function insertSecondarySource(args: {
  database: ContentDatabaseRow;
  sourceType: ContentDatabaseSourceType;
  sourceName: string;
  sourceTable: string;
  now: string;
}): Promise<string> {
  const db = getDb();
  const sourceId = crypto.randomUUID();
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: args.database.ownerEmail,
    orgId: args.database.orgId,
    databaseId: args.database.id,
    sourceType: args.sourceType,
    sourceName: args.sourceName,
    sourceTable: args.sourceTable,
    syncState: "linked",
    freshness: "fresh",
    capabilitiesJson: sourceCapabilitiesForType(args.sourceType),
    metadataJson: serializeSourceMetadataRecord({
      sourceType: args.sourceType,
      sourceTable: args.sourceTable,
    }),
    lastRefreshedAt: args.now,
    lastSourceUpdatedAt: args.now,
    lastError: null,
    createdAt: args.now,
    updatedAt: args.now,
  });
  return sourceId;
}

/**
 * Store a read-only secondary source's entries as join-by-key rows. They have no
 * local document (`documentId`/`databaseItemId` are empty sentinels) — the read
 * engine matches them purely by normalized canonical key. Replaces any prior
 * rows for the source so a re-store is idempotent.
 */
export async function storeSecondarySourceRows(args: {
  sourceId: string;
  ownerEmail: string;
  sourceType: ContentDatabaseSourceType;
  sourceTable: string;
  entries: BuilderCmsSourceEntry[];
  now: string;
}) {
  const db = getDb();
  await db
    .delete(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, args.sourceId));
  if (args.entries.length === 0) return;
  await db.insert(schema.contentDatabaseSourceRows).values(
    args.entries.map((entry, index) => ({
      id: crypto.randomUUID(),
      ownerEmail: args.ownerEmail,
      sourceId: args.sourceId,
      databaseItemId: "",
      documentId: "",
      sourceRowId: entry.id || `${args.sourceType}-${index + 1}`,
      sourceQualifiedId: `${args.sourceType}://${args.sourceTable}/${
        entry.id || index + 1
      }`,
      sourceDisplayKey:
        entry.title?.trim() || `${args.sourceTable}-${index + 1}`,
      sourceValuesJson: JSON.stringify(entry.sourceValues ?? {}),
      provenance: "secondary source row",
      syncState: "linked" as const,
      freshness: "fresh" as const,
      lastSyncedAt: args.now,
      lastSourceUpdatedAt: entry.updatedAt || args.now,
      createdAt: args.now,
      updatedAt: args.now,
    })),
  );
}

/**
 * Seed read-only field mappings for a secondary source from its model fields
 * (and any keys seen in a sample entry). Every field is read-only — write
 * fan-out is a LATER, live-write feature. Replaces any prior fields.
 */
export async function seedSecondarySourceFields(args: {
  sourceId: string;
  ownerEmail: string;
  modelFields: BuilderCmsModelFieldSummary[];
  sampleEntry?: BuilderCmsSourceEntry;
  now: string;
}) {
  const db = getDb();
  const existingFields = await db
    .select()
    .from(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, args.sourceId));
  const existingBySourceFieldKey = new Map(
    existingFields.map((field) => [field.sourceFieldKey, field]),
  );
  await db
    .delete(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, args.sourceId));
  const fieldTypeByKey = new Map(
    args.modelFields.map((field) => [
      field.name,
      normalizeBuilderCmsSourceFieldType(field.type),
    ]),
  );
  const modelFieldByName = new Map(
    args.modelFields.map((field) => [field.name, field]),
  );
  const sampleKeys = new Set(Object.keys(args.sampleEntry?.sourceValues ?? {}));
  const keys = new Set<string>(sampleKeys);
  for (const field of args.modelFields) {
    if (sampleKeys.has(field.name)) {
      keys.add(field.name);
    } else if (sampleKeys.has(`data.${field.name}`)) {
      keys.add(`data.${field.name}`);
    } else {
      keys.add(field.name);
    }
  }
  if (keys.size === 0) return;
  await db.insert(schema.contentDatabaseSourceFields).values(
    [...keys].map((key) => {
      const unprefixedKey = key.replace(/^data\./, "");
      const existing =
        existingBySourceFieldKey.get(key) ??
        (key.startsWith("data.")
          ? existingBySourceFieldKey.get(unprefixedKey)
          : existingBySourceFieldKey.get(`data.${key}`));
      const modelField =
        modelFieldByName.get(key) ?? modelFieldByName.get(unprefixedKey);
      return {
        id: crypto.randomUUID(),
        ownerEmail: args.ownerEmail,
        sourceId: args.sourceId,
        propertyId: existing?.propertyId ?? null,
        localFieldKey: existing?.localFieldKey ?? key,
        sourceFieldKey: key,
        sourceFieldLabel:
          modelField?.label ??
          existing?.sourceFieldLabel ??
          builderCmsModelFieldLabel(key),
        sourceFieldType:
          fieldTypeByKey.get(key) ??
          fieldTypeByKey.get(unprefixedKey) ??
          existing?.sourceFieldType ??
          "text",
        mappingType: "property" as const,
        writeOwner: "source" as const,
        readOnly: 1,
        provenance: "secondary source field",
        freshness: "fresh" as const,
        lastSyncedAt: args.now,
        createdAt: existing?.createdAt ?? args.now,
        updatedAt: args.now,
      };
    }),
  );
}

/** Merge a federation block into a source's stored metadata (primary or secondary). */
export async function writeSourceFederation(args: {
  sourceId: string;
  federation: ContentDatabaseSourceFederation;
  now: string;
}) {
  const db = getDb();
  const [current] = await db
    .select({ metadataJson: schema.contentDatabaseSources.metadataJson })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, args.sourceId));
  const metadata =
    parseObject<SourceMetadataRecord>(current?.metadataJson) ?? {};
  metadata.federation = args.federation;
  await db
    .update(schema.contentDatabaseSources)
    .set({ metadataJson: JSON.stringify(metadata), updatedAt: args.now })
    .where(eq(schema.contentDatabaseSources.id, args.sourceId));
}

export async function updateBuilderCmsSourceReadMetadata(args: {
  sourceId: string;
  sourceTable: string;
  readState: BuilderCmsReadState;
  entryCount: number;
  matchedRowCount: number;
  fetchedAt: string;
  now: string;
  message: string | null;
  progress?: BuilderCmsReadProgress;
  sourceFetchState?: "idle" | "fetching" | "error";
  activeReadSourceRowIds?: string[];
  syncState?: ContentDatabaseSourceSyncState;
  builderModelFields?: BuilderCmsModelFieldSummary[];
  suspiciousEmpty?: boolean;
}) {
  const db = getDb();
  const [currentSource] = await db
    .select({
      capabilitiesJson: schema.contentDatabaseSources.capabilitiesJson,
      metadataJson: schema.contentDatabaseSources.metadataJson,
      lastSourceUpdatedAt: schema.contentDatabaseSources.lastSourceUpdatedAt,
    })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, args.sourceId))
    .limit(1);
  const nextJson = mergeBuilderCmsWriteSettingsIntoJson({
    sourceTable: args.sourceTable,
    currentCapabilitiesJson: currentSource?.capabilitiesJson,
    currentMetadataJson: currentSource?.metadataJson,
    nextCapabilitiesJson: sourceCapabilitiesForType("builder-cms"),
    nextMetadataJson: serializeBuilderCmsSourceReadMetadataRecord({
      sourceTable: args.sourceTable,
      readState: args.readState,
      entryCount: args.entryCount,
      matchedRowCount: args.matchedRowCount,
      progress: args.progress,
      sourceFetchState: args.sourceFetchState,
      activeReadSourceRowIds: args.activeReadSourceRowIds,
      suspiciousEmpty: args.suspiciousEmpty,
      builderModelFields: args.builderModelFields,
      existingMetadataJson: currentSource?.metadataJson,
    }),
  });
  await db
    .update(schema.contentDatabaseSources)
    .set({
      syncState: args.syncState ?? "linked",
      freshness:
        args.readState === "error" ||
        args.progress?.partial ||
        args.suspiciousEmpty
          ? "stale"
          : "fresh",
      capabilitiesJson: nextJson.capabilitiesJson,
      metadataJson: nextJson.metadataJson,
      lastRefreshedAt: args.now,
      lastSourceUpdatedAt: args.suspiciousEmpty
        ? (currentSource?.lastSourceUpdatedAt ?? null)
        : args.fetchedAt,
      lastError:
        args.readState === "error" || args.suspiciousEmpty
          ? args.message
          : null,
      updatedAt: args.now,
    })
    .where(eq(schema.contentDatabaseSources.id, args.sourceId));
}

export async function getExistingSource(databaseId: string) {
  const db = getDb();
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, databaseId))
    // Oldest-first so "the source" is deterministically the primary, matching
    // getContentDatabaseSourceSnapshot. Without this, a multi-source database
    // could resolve a non-primary source when a caller omits sourceId. The `id`
    // tie-break keeps the choice stable when two sources share a createdAt
    // timestamp (no uniqueness guarantee on created_at).
    .orderBy(
      asc(schema.contentDatabaseSources.createdAt),
      asc(schema.contentDatabaseSources.id),
    );
  return source ?? null;
}

/** The source DB row for one attached source by id (scoped to the database). */
export async function getExistingSourceById(
  databaseId: string,
  sourceId: string,
) {
  const db = getDb();
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, databaseId),
        eq(schema.contentDatabaseSources.id, sourceId),
      ),
    );
  return source ?? null;
}

/** The source DB row for an action: explicit `sourceId` when given, else primary. */
export async function getExistingSourceForWrite(
  databaseId: string,
  sourceId?: string | null,
) {
  return sourceId
    ? getExistingSourceById(databaseId, sourceId)
    : getExistingSource(databaseId);
}

/** Whether a source for this model (sourceTable) is already attached. */
export async function databaseSourceExistsForTable(
  databaseId: string,
  sourceTable: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.contentDatabaseSources.id })
    .from(schema.contentDatabaseSources)
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, databaseId),
        eq(schema.contentDatabaseSources.sourceTable, sourceTable),
      ),
    );
  return !!row;
}

export const SOURCE_PROPERTY_NAME = "Source";
// The "Local" (no collection) option id. A fixed non-UUID sentinel so it never
// collides with a source id (which is what every collection option's id is).
export const SOURCE_LOCAL_OPTION_ID = "local";

const SOURCE_OPTION_PALETTE: DocumentPropertyOptionColor[] = [
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "yellow",
  "brown",
  "red",
];

/**
 * Ensure a "Source" select property exists tagging each row with the collection
 * it belongs to, and (re)set every item's value. Rows with no source binding are
 * "Local" — the same first-class state a brand-new local row has. Only runs once
 * a database has 2+ sources (row-union); a single-source database doesn't need
 * the tag. Option ids are preserved across re-runs so colors/filters stay stable.
 */
export async function ensureDatabaseSourceProperty(args: {
  database: ContentDatabaseRow;
  now: string;
}) {
  const db = getDb();
  const sources = await db
    .select({
      id: schema.contentDatabaseSources.id,
      sourceName: schema.contentDatabaseSources.sourceName,
    })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, args.database.id))
    .orderBy(asc(schema.contentDatabaseSources.createdAt));
  if (sources.length < 2) return;

  const [existing] = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.databaseId, args.database.id),
        eq(schema.documentPropertyDefinitions.name, SOURCE_PROPERTY_NAME),
        eq(schema.documentPropertyDefinitions.type, "select"),
      ),
    );

  const priorOptions = existing
    ? (parsePropertyOptions(existing.optionsJson).options ?? [])
    : [];
  // Each source option's id IS the sourceId (and "Local" uses a fixed sentinel
  // that can't collide with a UUID source id). Resolving a row's tag back to a
  // source is then pure id matching — no source-name hop — so duplicate display
  // names or a collection literally named "Local" can never misroute a row.
  const priorById = new Map(priorOptions.map((option) => [option.id, option]));
  const options = [
    ...sources.map((source, index) => ({
      id: source.id,
      name: source.sourceName,
      color:
        priorById.get(source.id)?.color ??
        SOURCE_OPTION_PALETTE[index % SOURCE_OPTION_PALETTE.length],
    })),
    {
      id: SOURCE_LOCAL_OPTION_ID,
      name: "Local",
      color: (priorById.get(SOURCE_LOCAL_OPTION_ID)?.color ??
        "gray") as DocumentPropertyOptionColor,
    },
  ];
  const optionsJson = serializePropertyOptions({ options });

  let propertyId: string;
  if (existing) {
    propertyId = existing.id;
    await db
      .update(schema.documentPropertyDefinitions)
      .set({ optionsJson, updatedAt: args.now })
      .where(eq(schema.documentPropertyDefinitions.id, existing.id));
  } else {
    const [maxPos] = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.documentPropertyDefinitions)
      .where(
        eq(schema.documentPropertyDefinitions.databaseId, args.database.id),
      );
    propertyId = crypto.randomUUID();
    await db.insert(schema.documentPropertyDefinitions).values({
      id: propertyId,
      ownerEmail: args.database.ownerEmail,
      orgId: args.database.orgId,
      databaseId: args.database.id,
      name: SOURCE_PROPERTY_NAME,
      type: "select",
      visibility: "always_show",
      optionsJson,
      position: (maxPos?.max ?? -1) + 1,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }

  // A row's Source value IS its owning source id (= the option id); unsourced
  // rows get the "Local" sentinel. Pure id mapping, no source-name hop.
  const rows = await db
    .select({
      documentId: schema.contentDatabaseSourceRows.documentId,
      sourceId: schema.contentDatabaseSourceRows.sourceId,
    })
    .from(schema.contentDatabaseSourceRows)
    .where(
      inArray(
        schema.contentDatabaseSourceRows.sourceId,
        sources.map((source) => source.id),
      ),
    );
  const ownerSourceIdByDocumentId = new Map<string, string>();
  for (const row of rows) {
    if (row.documentId)
      ownerSourceIdByDocumentId.set(row.documentId, row.sourceId);
  }

  const items = await db
    .select({ documentId: schema.contentDatabaseItems.documentId })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, args.database.id));
  for (const item of items) {
    const optionId =
      ownerSourceIdByDocumentId.get(item.documentId) ?? SOURCE_LOCAL_OPTION_ID;
    const valueJson = serializePropertyValue(optionId);
    const [existingValue] = await db
      .select({ id: schema.documentPropertyValues.id })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, item.documentId),
          eq(schema.documentPropertyValues.propertyId, propertyId),
        ),
      );
    if (existingValue) {
      await db
        .update(schema.documentPropertyValues)
        .set({ valueJson, updatedAt: args.now })
        .where(eq(schema.documentPropertyValues.id, existingValue.id));
    } else {
      await db.insert(schema.documentPropertyValues).values({
        id: crypto.randomUUID(),
        ownerEmail: args.database.ownerEmail,
        documentId: item.documentId,
        propertyId,
        valueJson,
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
  }
}

export async function getSourceRows(sourceId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, sourceId));
}

export async function listDatabasePropertiesAndItems(databaseId: string) {
  const { getContentDatabaseResponse } = await import("./_database-utils.js");
  return getContentDatabaseResponse(databaseId);
}

export async function sourceSetupPayload(databaseId: string) {
  const [properties, response] = await Promise.all([
    listPropertiesForDatabase(databaseId),
    listDatabasePropertiesAndItems(databaseId),
  ]);
  return { properties, response };
}

export async function updateSourceRefreshTimestamps(
  sourceId: string,
  now: string,
) {
  const db = getDb();
  await db
    .update(schema.contentDatabaseSources)
    .set({
      syncState: "idle",
      freshness: "fresh",
      lastRefreshedAt: now,
      lastSourceUpdatedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(schema.contentDatabaseSources.id, sourceId));
  await db
    .update(schema.contentDatabaseSourceRows)
    .set({
      syncState: "idle",
      freshness: "fresh",
      lastSyncedAt: now,
      lastSourceUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.contentDatabaseSourceRows.sourceId, sourceId));
  await db
    .update(schema.contentDatabaseSourceFields)
    .set({
      freshness: "fresh",
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.contentDatabaseSourceFields.sourceId, sourceId));
}

export async function propertyForMockChange(args: {
  item: ContentDatabaseItem;
  propertyId?: string;
}) {
  const properties = args.item.properties;
  return (
    properties.find((property) => property.definition.id === args.propertyId) ??
    properties.find(
      (property) =>
        property.editable &&
        property.definition.type !== "formula" &&
        property.definition.type !== "rollup",
    ) ??
    null
  );
}

export async function listSourceFieldMappingsForPropertyIds(
  sourceId: string,
  propertyIds: string[],
) {
  if (propertyIds.length === 0) return [];
  const db = getDb();
  return db
    .select()
    .from(schema.contentDatabaseSourceFields)
    .where(
      and(
        eq(schema.contentDatabaseSourceFields.sourceId, sourceId),
        inArray(schema.contentDatabaseSourceFields.propertyId, propertyIds),
      ),
    );
}
