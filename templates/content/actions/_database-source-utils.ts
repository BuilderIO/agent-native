import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabase,
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
import {
  readBuilderCmsContentEntries,
  readBuilderCmsModelFields,
  type BuilderCmsReadState,
} from "./_builder-cms-read-client.js";
import { listPropertiesForDatabase, nanoid } from "./_property-utils.js";
import { sanitizeNormalizationFormula } from "../shared/properties.js";

type ContentDatabaseRow = typeof schema.contentDatabases.$inferSelect;
type ContentDatabaseSourceRowDb =
  typeof schema.contentDatabaseSources.$inferSelect;
type ContentDatabaseSourceFieldRowDb =
  typeof schema.contentDatabaseSourceFields.$inferSelect;
type ContentDatabaseSourceRecordRowDb =
  typeof schema.contentDatabaseSourceRows.$inferSelect;
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
  if (args.changeSet.pushMode === "publish") {
    riskLevel = maxRisk(riskLevel, "high");
    riskReasons.push("publish mode");
  }
  if (
    args.changeSet.direction === "outbound" &&
    normalizeCapabilities(args.source.capabilitiesJson).liveWritesEnabled
  ) {
    riskLevel = maxRisk(riskLevel, "high");
    riskReasons.push("live writes enabled");
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

export function buildBuilderLocalOutboundChangeSets(args: {
  source: ContentDatabaseSourceRowDb;
  rowRows: ContentDatabaseSourceRecordRowDb[];
  documentTitleById: Map<string, string>;
  storedChangeSets: ContentDatabaseSourceChangeSet[];
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
    if (!localTitle || localTitle === sourceTitle) continue;

    const fieldChanges: ContentDatabaseSourceFieldChange[] = [
      {
        propertyId: null,
        propertyName: "Title",
        localFieldKey: "title",
        sourceFieldKey: "data.title",
        currentValue: sourceTitle,
        proposedValue: localTitle,
      },
    ];
    const matchingStoredChange = args.storedChangeSets.some((changeSet) => {
      if (
        changeSet.direction !== "outbound" ||
        changeSet.documentId !== row.documentId ||
        changeSet.pushMode !== "autosave" ||
        changeSet.state === "rejected" ||
        changeSet.state === "applied"
      ) {
        return false;
      }
      return changeSet.fieldChanges.some(
        (fieldChange) =>
          fieldChange.localFieldKey === "title" &&
          fieldChange.currentValue === sourceTitle &&
          fieldChange.proposedValue === localTitle,
      );
    });
    if (matchingStoredChange) continue;

    const now = new Date().toISOString();
    pending.push({
      id: `local-pending-${row.id}-title`,
      databaseItemId: row.databaseItemId,
      documentId: row.documentId,
      kind: "field_update",
      direction: "outbound",
      state: "pending_push",
      pushMode: "autosave",
      localOnly: true,
      summary: `Pending local Builder CMS title change for "${localTitle}".`,
      fieldChanges,
      bodyChange: null,
      riskLevel: "low",
      riskReasons: ["single field diff"],
      conflictState: "none",
      reviewEvents: [],
      executions: [],
      createdAt: now,
      updatedAt: now,
    });
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
      .where(eq(schema.contentDatabases.id, args.databaseId));
    return database ?? null;
  }
  if (args.documentId) {
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.documentId, args.documentId));
    return database ?? null;
  }
  return null;
}

export async function getContentDatabaseSourceSnapshot(
  database: ContentDatabaseRow | ContentDatabase,
): Promise<ContentDatabaseSource | null> {
  const db = getDb();
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, database.id))
    .orderBy(asc(schema.contentDatabaseSources.createdAt));
  if (!source) return null;
  return loadSourceSnapshot(source, database);
}

/**
 * Load every source attached to a database (oldest first → `[0]` is the
 * primary). Federation joins read this; single-source callers keep using
 * `getContentDatabaseSourceSnapshot`, which returns the primary.
 */
export async function getAllContentDatabaseSourceSnapshots(
  database: ContentDatabaseRow | ContentDatabase,
): Promise<ContentDatabaseSource[]> {
  const db = getDb();
  const sources = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, database.id))
    .orderBy(asc(schema.contentDatabaseSources.createdAt));
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
  const rowDocuments =
    rowRows.length > 0
      ? await db
          .select({
            id: schema.documents.id,
            title: schema.documents.title,
          })
          .from(schema.documents)
          .where(
            and(
              inArray(
                schema.documents.id,
                rowRows.map((row) => row.documentId),
              ),
              eq(schema.documents.ownerEmail, source.ownerEmail),
            ),
          )
      : [];
  const documentTitleById = new Map(
    rowDocuments.map((document) => [document.id, document.title]),
  );
  const localOutboundChangeSets = buildBuilderLocalOutboundChangeSets({
    source,
    rowRows,
    documentTitleById,
    storedChangeSets,
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
    capabilities: normalizeCapabilities(source.capabilitiesJson),
    metadata: {
      primaryKey: metadata.primaryKey ?? "id",
      titleField: metadata.titleField ?? "title",
      naturalKeyField: metadata.naturalKeyField ?? null,
      pushMode: metadata.pushMode ?? "none",
      pushModeLabel: metadata.pushModeLabel ?? null,
      pushModeDescription: metadata.pushModeDescription ?? null,
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
  };
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
    ...args.properties.map((property) => ({
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
    })),
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
    if (existingTitles.has(titleKey)) continue;
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
  let existingRows = await db
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, args.source.id));
  if (builderRead.state === "live") {
    const imported = await importBuilderCmsEntriesAsDatabaseItems({
      database: args.database,
      entries: builderRead.entries,
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
          entries: builderRead.entries,
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
    builderSampleEntries:
      builderRead.state === "live" ? builderRead.entries : [],
    now: args.now,
  });
  await seedMockSourceRows({
    sourceId: args.source.id,
    ownerEmail: args.database.ownerEmail,
    sourceType: "builder-cms",
    sourceTable: args.source.sourceTable,
    items: response.items,
    now: args.now,
    existingBuilderRows,
    builderEntriesByDocumentId,
  });

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
  await db
    .delete(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.sourceId, args.sourceId));
  const fieldTypeByKey = new Map(
    args.modelFields.map((field) => [
      field.name,
      normalizeBuilderCmsSourceFieldType(field.type),
    ]),
  );
  const keys = new Set<string>(args.modelFields.map((field) => field.name));
  for (const key of Object.keys(args.sampleEntry?.sourceValues ?? {})) {
    keys.add(key);
  }
  if (keys.size === 0) return;
  await db.insert(schema.contentDatabaseSourceFields).values(
    [...keys].map((key) => ({
      id: crypto.randomUUID(),
      ownerEmail: args.ownerEmail,
      sourceId: args.sourceId,
      propertyId: null,
      localFieldKey: key,
      sourceFieldKey: key,
      sourceFieldLabel:
        args.modelFields.find((field) => field.name === key)?.label ??
        builderCmsModelFieldLabel(key),
      sourceFieldType: fieldTypeByKey.get(key) ?? "text",
      mappingType: "property" as const,
      writeOwner: "source" as const,
      readOnly: 1,
      provenance: "secondary source field",
      freshness: "fresh" as const,
      lastSyncedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    })),
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
    .where(eq(schema.contentDatabaseSources.databaseId, databaseId));
  return source ?? null;
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
