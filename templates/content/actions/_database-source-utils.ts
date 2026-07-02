import { deleteCollabState, releaseDoc } from "@agent-native/core/collab";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

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
  parsePropertyOptions,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptionColor,
} from "../shared/properties.js";
import { sanitizeNormalizationFormula } from "../shared/properties.js";
import {
  readBuilderCmsContentEntries,
  readBuilderCmsModelFields,
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
  allowDraftWrites?: boolean;
  allowPublishWrites?: boolean;
  allowedWriteModes?: ContentDatabaseSourcePushMode[];
  federation?: ContentDatabaseSourceFederation;
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
  if (
    value === "builder-cms" ||
    value === "local-table" ||
    value === "local-folder" ||
    value === "github-url"
  ) {
    return value;
  }
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
  if (sourceType === "local-folder") return `local.folder.${sourceTable}`;
  if (sourceType === "github-url") return `github.url.${sourceTable}`;
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
): ContentDatabaseSourceRow {
  return {
    id: row.id,
    databaseItemId: row.databaseItemId,
    documentId: row.documentId,
    sourceRowId: row.sourceRowId,
    sourceQualifiedId: row.sourceQualifiedId,
    sourceDisplayKey: row.sourceDisplayKey,
    sourceValues:
      parseObject<Record<string, DocumentPropertyValue>>(
        row.sourceValuesJson,
      ) ?? {},
    provenance: row.provenance,
    syncState: normalizeSourceSyncState(row.syncState),
    freshness: normalizeSourceFreshness(row.freshness),
    lastSyncedAt: row.lastSyncedAt,
    lastSourceUpdatedAt: row.lastSourceUpdatedAt,
  };
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

const BUILDER_BODY_HYDRATION_BACKGROUND_PRIORITY = 10;
const BUILDER_BODY_HYDRATION_OPEN_PRIORITY = 0;
const BUILDER_BODY_HYDRATION_BATCH_LIMIT = 8;
const BUILDER_BODY_HYDRATION_CODEC_VERSION = "readable-native-images-v4";

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
  const db = getDb();
  const sourceRowId = args.entry.id;
  const priority = args.priority ?? BUILDER_BODY_HYDRATION_BACKGROUND_PRIORITY;
  const [existing] = await db
    .select()
    .from(schema.contentDatabaseBodyHydrationQueue)
    .where(
      eq(
        schema.contentDatabaseBodyHydrationQueue.databaseItemId,
        args.databaseItemId,
      ),
    );
  const values = {
    ownerEmail: args.ownerEmail,
    orgId: args.orgId,
    sourceId: args.sourceId,
    databaseItemId: args.databaseItemId,
    documentId: args.documentId,
    sourceRowId,
    sourceTable: args.sourceTable,
    sourceEntryJson: JSON.stringify(args.entry),
    priority: Math.min(existing?.priority ?? priority, priority),
    lastError: null,
    updatedAt: args.now,
  };
  if (existing) {
    await db
      .update(schema.contentDatabaseBodyHydrationQueue)
      .set(values)
      .where(eq(schema.contentDatabaseBodyHydrationQueue.id, existing.id));
  } else {
    await db.insert(schema.contentDatabaseBodyHydrationQueue).values({
      id: crypto.randomUUID(),
      ...values,
      attempts: 0,
      lastAttemptedAt: null,
      createdAt: args.now,
    });
  }
  await db
    .update(schema.contentDatabaseItems)
    .set({
      bodyHydrationStatus: "pending",
      bodyHydrationError: null,
      updatedAt: args.now,
    })
    .where(eq(schema.contentDatabaseItems.id, args.databaseItemId));
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
  for (const item of args.items) {
    const entry = args.builderEntriesByDocumentId.get(item.document.id);
    if (!entry?.rawEntry) continue;
    if (
      item.bodyHydration?.status === "hydrated" &&
      item.bodyHydration.version === builderBodyHydrationVersion(entry) &&
      !builderBodyIsRawPlaceholderOnly(item.document.content)
    ) {
      continue;
    }
    await enqueueBuilderBodyHydration({
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
  void processBuilderBodyHydrationQueue({
    sourceId: args.sourceId,
    limit: BUILDER_BODY_HYDRATION_BATCH_LIMIT,
  }).catch(() => undefined);
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
) {
  const db = getDb();
  const [claimed] = await db
    .update(schema.contentDatabaseBodyHydrationQueue)
    .set({
      attempts: row.attempts + 1,
      lastAttemptedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.contentDatabaseBodyHydrationQueue.id, row.id),
        eq(
          schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
          row.sourceEntryJson,
        ),
      ),
    )
    .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
  if (!claimed) return;

  await db
    .update(schema.contentDatabaseItems)
    .set({
      bodyHydrationStatus: "hydrating",
      bodyHydrationAttemptedAt: now,
      bodyHydrationError: null,
      updatedAt: now,
    })
    .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));

  const entry = parseHydrationEntry(row);
  if (!entry) throw new Error("Builder body hydration entry is missing.");
  const entryWithBody = await refreshBuilderBodySourceValuesFromStoredLossless(
    await withBuilderBodySourceValues(entry),
  );
  const sourceValues =
    parseObject<Record<string, DocumentPropertyValue>>(
      (
        await db
          .select({
            sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
          })
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
      )[0]?.sourceValuesJson ?? "{}",
    ) ?? {};
  const nextValues = {
    ...sourceValues,
    ...entryWithBody.sourceValues,
  };
  const nextContent =
    stringSourceValue(nextValues, BUILDER_CMS_BODY_CONTENT_KEY) ?? "";
  const [document] = await db
    .select({ content: schema.documents.content })
    .from(schema.documents)
    .where(eq(schema.documents.id, row.documentId));
  const previousContent =
    stringSourceValue(sourceValues, BUILDER_CMS_BODY_CONTENT_KEY) ?? "";
  const currentContent = document?.content ?? "";
  const shouldWriteBody =
    currentContent === "" ||
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
    if (shouldWriteBody) {
      const [updatedDocument] = await tx
        .update(schema.documents)
        .set({ content: nextContent, updatedAt: now })
        .where(
          and(
            eq(schema.documents.id, row.documentId),
            eq(schema.documents.content, currentContent),
          ),
        )
        .returning({ id: schema.documents.id });
      wroteBody = Boolean(updatedDocument);
    }
    if (shouldWriteBody && !wroteBody) {
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
      await tx
        .update(schema.contentDatabaseBodyHydrationQueue)
        .set({
          lastError:
            "Skipped Builder body hydration because the document changed during sync.",
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.contentDatabaseBodyHydrationQueue.id, row.id),
            eq(
              schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
              row.sourceEntryJson,
            ),
          ),
        );
      return;
    }
    const [deleted] = await tx
      .delete(schema.contentDatabaseBodyHydrationQueue)
      .where(
        and(
          eq(schema.contentDatabaseBodyHydrationQueue.id, row.id),
          eq(
            schema.contentDatabaseBodyHydrationQueue.sourceEntryJson,
            row.sourceEntryJson,
          ),
        ),
      )
      .returning({ id: schema.contentDatabaseBodyHydrationQueue.id });
    if (!deleted) {
      if (wroteBody) {
        await tx
          .update(schema.contentDatabaseSourceRows)
          .set({
            sourceValuesJson: JSON.stringify(nextValues),
            lastSyncedAt: now,
            lastSourceUpdatedAt: entry.updatedAt ?? now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.contentDatabaseSourceRows.sourceId, row.sourceId),
              eq(
                schema.contentDatabaseSourceRows.databaseItemId,
                row.databaseItemId,
              ),
            ),
          );
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
      return;
    }
    await tx
      .update(schema.contentDatabaseSourceRows)
      .set({
        sourceValuesJson: JSON.stringify(nextValues),
        lastSyncedAt: now,
        lastSourceUpdatedAt: entry.updatedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.contentDatabaseSourceRows.sourceId, row.sourceId),
          eq(
            schema.contentDatabaseSourceRows.databaseItemId,
            row.databaseItemId,
          ),
        ),
      );
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
  const jobs = await db
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
        : eq(schema.contentDatabaseBodyHydrationQueue.sourceId, args.sourceId),
    )
    .orderBy(
      asc(schema.contentDatabaseBodyHydrationQueue.priority),
      asc(schema.contentDatabaseBodyHydrationQueue.createdAt),
    )
    .limit(limit);

  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    const attemptNow = new Date().toISOString();
    try {
      await processBuilderBodyHydrationJob(job, attemptNow);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(schema.contentDatabaseItems)
        .set({
          bodyHydrationStatus: "error",
          bodyHydrationAttemptedAt: attemptNow,
          bodyHydrationError: message,
          updatedAt: attemptNow,
        })
        .where(eq(schema.contentDatabaseItems.id, job.databaseItemId));
      await db
        .update(schema.contentDatabaseBodyHydrationQueue)
        .set({
          attempts: job.attempts + 1,
          lastAttemptedAt: attemptNow,
          lastError: message,
          priority: job.priority + 10,
          updatedAt: attemptNow,
        })
        .where(eq(schema.contentDatabaseBodyHydrationQueue.id, job.id));
    }
  }
  const [remaining] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.contentDatabaseBodyHydrationQueue)
    .where(
      eq(schema.contentDatabaseBodyHydrationQueue.sourceId, args.sourceId),
    );
  return {
    sourceId: args.sourceId,
    processed: jobs.length,
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

async function builderBodyChangeForLocalContent(args: {
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
        if (sameSourceFieldValue(localValue, baseValue)) continue;
        fieldChanges.push({
          propertyId: field.propertyId,
          propertyName: field.sourceFieldLabel,
          localFieldKey: field.localFieldKey,
          sourceFieldKey: field.sourceFieldKey,
          currentValue: (baseValue ?? null) as DocumentPropertyValue,
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
          fieldChanges.some(
            (change) =>
              change.localFieldKey === stored.localFieldKey &&
              sameSourceFieldValue(change.currentValue, stored.currentValue) &&
              sameSourceFieldValue(change.proposedValue, stored.proposedValue),
          ),
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
  return loadSourceSnapshot(source, database);
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
  return loadSourceSnapshot(source, database);
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
  return sourceId
    ? getContentDatabaseSourceSnapshotById(database, sourceId)
    : getContentDatabaseSourceSnapshot(database);
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
    snapshots.push(await loadSourceSnapshot(source, database));
  }
  return snapshots;
}

async function loadSourceSnapshot(
  source: ContentDatabaseSourceRowDb,
  database: ContentDatabaseRow | ContentDatabase,
): Promise<ContentDatabaseSource> {
  const db = getDb();
  const [
    fieldRows,
    rowRows,
    changeRows,
    reviewRows,
    executionRows,
    propertyDefs,
  ] = await Promise.all([
    db
      .select()
      .from(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.sourceId, source.id))
      .orderBy(asc(schema.contentDatabaseSourceFields.createdAt)),
    db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id))
      .orderBy(asc(schema.contentDatabaseSourceRows.createdAt)),
    db
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.sourceId, source.id))
      .orderBy(asc(schema.contentDatabaseSourceChangeSets.createdAt)),
    db
      .select()
      .from(schema.contentDatabaseSourceChangeReviews)
      .where(eq(schema.contentDatabaseSourceChangeReviews.sourceId, source.id))
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
      })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, database.id)),
  ]);

  const propertyNameById = new Map(
    propertyDefs.map((row) => [row.id, row.name]),
  );
  const fields = fieldRows.map((row) =>
    serializeSourceField(
      row,
      row.propertyId ? (propertyNameById.get(row.propertyId) ?? null) : null,
    ),
  );
  const rows = rowRows.map(serializeSourceRowRecord);
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
  // For Builder sources, load ALL database items (not just synced source rows)
  // so brand-new local rows (no source link) can become create_draft change-sets.
  const databaseItemRows = isBuilderSource
    ? await db
        .select({
          id: schema.contentDatabaseItems.id,
          documentId: schema.contentDatabaseItems.documentId,
          bodyHydrationStatus: schema.contentDatabaseItems.bodyHydrationStatus,
        })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, database.id),
            eq(schema.contentDatabaseItems.ownerEmail, source.ownerEmail),
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
              eq(schema.documents.ownerEmail, source.ownerEmail),
            ),
          )
      : [];
  const documentTitleById = new Map(
    rowDocuments.map((document) => [document.id, document.title]),
  );
  const documentContentById = new Map(
    rowDocuments.map((document) => [document.id, document.content]),
  );
  const propertyValueRows =
    isBuilderSource && allDocumentIds.length > 0
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
              eq(schema.documentPropertyValues.ownerEmail, source.ownerEmail),
            ),
          )
      : [];
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
  if (isBuilderSource) {
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
        const row = sourceRowByDocumentId.get(documentId) ?? {
          sourceValuesJson: "{}",
        };
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
    .select({ status: schema.contentDatabaseItems.bodyHydrationStatus })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabaseSourceRows,
      eq(
        schema.contentDatabaseSourceRows.databaseItemId,
        schema.contentDatabaseItems.id,
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
    if (row.status === "pending") summary.pending += 1;
    else if (row.status === "hydrating") summary.hydrating += 1;
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
}) {
  const isBuilder = args.sourceType === "builder-cms";
  if (isBuilder) {
    return JSON.stringify(builderCmsSourceMetadata(args.sourceTable));
  }
  if (args.sourceType === "local-folder") {
    return JSON.stringify({
      primaryKey: "path",
      titleField: "title",
      naturalKeyField: "path",
      pushMode: "none",
      pushModeLabel: "Repo truth",
      pushModeDescription:
        "The mounted local folder is the source of truth; Content keeps scope and search metadata only.",
      notes:
        "Local folder workspace registration. File writes stay on the local-file action path and git review remains external.",
      readMode: "local-files",
      label: sourceMetadataLabel(args.sourceType, args.sourceTable),
      truthSemantics: "local-folder",
    });
  }
  if (args.sourceType === "github-url") {
    return JSON.stringify({
      primaryKey: "url",
      titleField: "title",
      naturalKeyField: "url",
      pushMode: "none",
      pushModeLabel: "Git truth",
      pushModeDescription:
        "The GitHub URL identifies repo truth; this registration does not clone, commit, or push.",
      notes:
        "GitHub URL workspace registration for source scope. Full Git workflow automation is intentionally out of scope.",
      readMode: "github-url",
      label: sourceMetadataLabel(args.sourceType, args.sourceTable),
      truthSemantics: "github-url",
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
}) {
  return JSON.stringify({
    ...builderCmsSourceMetadata(args.sourceTable),
    readMode: args.readState === "live" ? "builder-api" : "fixture",
    liveReadConfigured: args.readState === "live",
    lastReadEntryCount: args.entryCount,
    lastReadMatchedRowCount: args.matchedRowCount,
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
  if (sourceType === "local-folder" || sourceType === "github-url") {
    return serializeSourceCapabilitiesRecord({
      canRefresh: false,
      canCreateChangeSets: false,
      canWriteFields: false,
      canWriteBody: false,
      canPush: false,
      canPull: false,
      canPublish: false,
      canStageLocalRevision: false,
      liveWritesEnabled: false,
      readOnlyRefresh: false,
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
  now: string;
}) {
  const db = getDb();
  const isBuilder = args.sourceType === "builder-cms";
  const isMountedRepoSource =
    args.sourceType === "local-folder" || args.sourceType === "github-url";
  const rows = [
    ...(!isMountedRepoSource
      ? [
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
        ]
      : []),
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
    ...(isMountedRepoSource
      ? [
          {
            id: crypto.randomUUID(),
            ownerEmail: args.ownerEmail,
            sourceId: args.sourceId,
            propertyId: null,
            localFieldKey:
              args.sourceType === "github-url" ? "github_url" : "source_path",
            sourceFieldKey: args.sourceType === "github-url" ? "url" : "path",
            sourceFieldLabel:
              args.sourceType === "github-url" ? "GitHub URL" : "Local path",
            sourceFieldType: args.sourceType === "github-url" ? "url" : "text",
            mappingType: "system",
            writeOwner: "source",
            readOnly: 1,
            provenance:
              args.sourceType === "github-url"
                ? "GitHub URL workspace identity"
                : "Local folder workspace identity",
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
    ...(!isMountedRepoSource
      ? args.properties
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
              ? builderCmsSourceFieldKey(
                  property.definition.id,
                  property.definition.name,
                )
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
          }))
      : []),
  ];
  if (isBuilder) {
    const existingSourceFieldKeys = new Set(
      rows.map((row) => row.sourceFieldKey.trim().toLowerCase()),
    );
    for (const field of args.builderModelFields ?? []) {
      const fieldName = field.name.trim();
      if (!fieldName) continue;
      const sourceFieldKey = `data.${fieldName}`;
      const normalizedKey = sourceFieldKey.toLowerCase();
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
        const normalizedKey = sourceFieldKey.toLowerCase();
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

  await db.insert(schema.contentDatabaseSourceFields).values(rows);
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
  if (args.builderEntry?.sourceValues) return args.builderEntry.sourceValues;
  if (existingSourceValues) return existingSourceValues;
  if (args.sourceType === "local-folder") {
    return {
      title: args.item.document.title,
      path:
        args.item.document.source?.path ??
        args.item.document.source?.rootPath ??
        args.sourceTable,
      "sys.truth": "local-folder",
    };
  }
  if (args.sourceType === "github-url") {
    return {
      title: args.item.document.title,
      url: args.sourceTable,
      "sys.truth": "github-url",
    };
  }
  if (args.sourceType !== "builder-cms") return {};
  return buildBuilderCmsFixtureEntry({
    item: args.item,
    sourceTable: args.sourceTable,
    now: args.now,
  }).sourceValues;
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
}) {
  if (args.entries.length === 0) return 0;
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
  let imported = 0;

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
    await db.insert(schema.documents).values({
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
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: args.database.ownerEmail,
      orgId: args.database.orgId,
      databaseId: args.database.id,
      documentId,
      position: nextItemPosition++,
      bodyHydrationStatus: entry.rawEntry ? "pending" : "hydrated",
      bodyHydrationError: null,
      createdAt: args.now,
      updatedAt: args.now,
    });
    imported += 1;
  }

  return imported;
}

export async function resyncBuilderCmsSourceSnapshot(args: {
  database: ContentDatabaseRow;
  source: ContentDatabaseSourceRowDb;
  now: string;
}) {
  let { properties, response } = await sourceSetupPayload(args.database.id);
  const db = getDb();
  const builderRead = await readBuilderCmsContentEntries({
    model: args.source.sourceTable,
  });
  const builderEntries =
    builderRead.state === "live" ? builderRead.entries : [];
  let existingRows = await db
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));
  if (builderRead.state === "live") {
    const imported = await importBuilderCmsEntriesAsDatabaseItems({
      database: args.database,
      entries: builderEntries,
      now: args.now,
      sourceTable: args.source.sourceTable,
      existingSourceRows: existingRows,
    });
    if (imported && imported > 0) {
      ({ properties, response } = await sourceSetupPayload(args.database.id));
      existingRows = await db
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));
    }
  }
  const builderModelFields = await readBuilderCmsModelFields({
    model: args.source.sourceTable,
  });
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
  await db
    .delete(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
  await db
    .delete(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));

  await seedMockSourceFields({
    sourceId: args.source.id,
    ownerEmail: args.database.ownerEmail,
    sourceType: "builder-cms",
    properties,
    builderModelFields,
    builderSampleEntries: builderEntries,
    now: args.now,
  });
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
  syncState?: ContentDatabaseSourceSyncState;
}) {
  const db = getDb();
  const [currentSource] = await db
    .select({
      capabilitiesJson: schema.contentDatabaseSources.capabilitiesJson,
      metadataJson: schema.contentDatabaseSources.metadataJson,
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
    }),
  });
  await db
    .update(schema.contentDatabaseSources)
    .set({
      syncState: args.syncState ?? "linked",
      freshness: args.readState === "error" ? "stale" : "fresh",
      capabilitiesJson: nextJson.capabilitiesJson,
      metadataJson: nextJson.metadataJson,
      lastRefreshedAt: args.now,
      lastSourceUpdatedAt: args.fetchedAt,
      lastError: args.readState === "error" ? args.message : null,
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
