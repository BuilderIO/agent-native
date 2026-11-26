import { createHash, randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { resolveAccessMany, roleSatisfies } from "@agent-native/core/sharing";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  builderEntryEditorUrl,
  type BuilderArticleAutosaveReason,
  type BuilderArticleAutosaveState,
  type BuilderArticleAutosaveStatus,
  type BuilderArticleRowStatus,
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
  type ContentDatabaseSourcePushMode,
  type DocumentPropertyValue,
  type ExecuteBuilderSourceExecutionRequest,
  type PrepareBuilderSourceReviewResponse,
} from "../shared/api.js";
import {
  BUILDER_ARTICLE_AUTOSAVE_NEW_ROW_WINDOW_MS,
  BUILDER_ARTICLE_AUTOSAVE_QUIET_MS,
  BUILDER_ARTICLE_AUTOSAVE_RECHECK_MS,
  BUILDER_ARTICLE_AUTOSAVE_UNCONFIRMED_STOP,
  BUILDER_ARTICLE_AUTOSAVE_UNSETTLED_EXECUTION_STATES,
  builderArticleAutosaveAllowsEffect,
  builderArticleAutosaveAllowsPublication,
} from "./_builder-article-autosave-rules.js";
import {
  BUILDER_EXECUTION_CLAIM_TIMEOUT_MS,
  builderExecutionStaleBefore,
} from "./_builder-cms-execution-lease.js";
import { readBuilderCmsEditConflicts } from "./_builder-cms-unpublished-changes.js";
import {
  resolveBuilderCmsExecutionPushMode,
  resolveBuilderCmsWriteEffect,
} from "./_builder-cms-write-adapter.js";
import {
  resolveDatabaseForSourceMutation,
  type BuilderUnreadBody,
} from "./_database-source-utils.js";
import { accessibleDocumentIds } from "./_document-access.js";

type DatabaseRecord = NonNullable<
  Awaited<ReturnType<typeof resolveDatabaseForSourceMutation>>
>;

type AutosaveRecord =
  typeof schema.contentDatabaseBuilderAutosaves.$inferSelect;

interface BuilderSourceRecord {
  id: string;
  sourceTable: string;
  writable: boolean;
}

interface ArticleRow {
  documentId: string;
  databaseId: string;
  databaseItemId: string;
  sourceId: string;
  entryId: string | null;
  sourceValues: Record<string, DocumentPropertyValue> | null;
  record: AutosaveRecord | null;
  eligible: boolean;
}

const STATE_VALUES = [
  "idle",
  "saving",
  "saved",
  "waiting",
  "failed",
  "review",
] as const satisfies readonly BuilderArticleAutosaveState[];
const REASON_VALUES = [
  "builder_editor_changes",
  "checking_last_save",
  "another_save_running",
  "builder_body_unread",
  "builder_body_unreadable",
  "published",
  "needs_review",
  "edit_conflict",
  "builder_changed",
  "save_failed",
  "unconfirmed_save",
] as const satisfies readonly BuilderArticleAutosaveReason[];
const STATES = new Set<string>(STATE_VALUES);
const REASONS = new Set<string>(REASON_VALUES);

export const builderArticleRowStatusSchema = z.object({
  documentId: z.string(),
  databaseId: z.string(),
  sourceId: z.string(),
  databaseItemId: z.string(),
  entryId: z.string().nullable(),
  builderUrl: z.string().nullable(),
  autosave: z
    .object({
      enabled: z.boolean(),
      state: z.enum(STATE_VALUES),
      reason: z.enum(REASON_VALUES).nullable(),
      error: z.string().nullable(),
      lastSavedAt: z.string().nullable(),
      due: z.boolean(),
      dueSoon: z.boolean(),
      canSave: z.boolean(),
    })
    .nullable(),
});

const QUERY_CHUNK = 500;

function chunks<T>(values: T[]) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += QUERY_CHUNK) {
    result.push(values.slice(index, index + QUERY_CHUNK));
  }
  return result;
}

function firstOf<T>(values: readonly T[]): T | undefined {
  return values.length > 0 ? values[0] : undefined;
}

function parseRecord(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function builderAutosaveId(sourceId: string, databaseItemId: string) {
  const digest = createHash("sha256")
    .update(`${sourceId}\u0000${databaseItemId}`)
    .digest("hex")
    .slice(0, 32);
  return `builder-autosave-${digest}`;
}

function sourceIsWritable(source: {
  sourceTable: string;
  capabilitiesJson: string;
  metadataJson: string;
}) {
  return (
    source.sourceTable === BUILDER_CMS_SAFE_WRITE_MODEL &&
    parseRecord(source.capabilitiesJson)?.liveWritesEnabled === true &&
    parseRecord(source.metadataJson)?.writeMode !== "read_only"
  );
}

async function readEditStamps(documentIds: string[]) {
  const stamps = new Map<string, string>();
  const db = getDb();
  const later = (documentId: string, value: string | null | undefined) => {
    if (!value) return;
    const current = stamps.get(documentId);
    if (!current || value > current) stamps.set(documentId, value);
  };
  for (const ids of chunks(documentIds)) {
    // guard:allow-unscoped — reads update times of rows in a collection whose access the caller checked.
    const pages = await db
      .select({
        id: schema.documents.id,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(inArray(schema.documents.id, ids));
    for (const page of pages) later(page.id, page.updatedAt);
    const values = await db
      .select({
        documentId: schema.documentPropertyValues.documentId,
        updatedAt: sql<string>`max(${schema.documentPropertyValues.updatedAt})`,
      })
      .from(schema.documentPropertyValues)
      .innerJoin(
        schema.documentPropertyDefinitions,
        eq(
          schema.documentPropertyDefinitions.id,
          schema.documentPropertyValues.propertyId,
        ),
      )
      .where(
        and(
          inArray(schema.documentPropertyValues.documentId, ids),
          isNull(schema.documentPropertyDefinitions.systemRole),
        ),
      )
      .groupBy(schema.documentPropertyValues.documentId);
    for (const value of values) later(value.documentId, value.updatedAt);
  }
  return stamps;
}

async function readArticleRows(args: {
  database: DatabaseRecord;
  documentId?: string;
}) {
  const db = getDb();
  const sources = await db
    .select({
      id: schema.contentDatabaseSources.id,
      sourceType: schema.contentDatabaseSources.sourceType,
      sourceTable: schema.contentDatabaseSources.sourceTable,
      capabilitiesJson: schema.contentDatabaseSources.capabilitiesJson,
      metadataJson: schema.contentDatabaseSources.metadataJson,
    })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, args.database.id));
  const builderSources = new Map<string, BuilderSourceRecord>(
    sources
      .filter((source) => source.sourceType === "builder-cms")
      .map((source) => [
        source.id,
        {
          id: source.id,
          sourceTable: source.sourceTable,
          writable: sourceIsWritable(source),
        },
      ]),
  );
  if (builderSources.size === 0) {
    return { builderSources, rows: [] as ArticleRow[] };
  }
  const firstSource = firstOf(sources);
  const onlySource =
    sources.length === 1 && firstSource
      ? builderSources.get(firstSource.id)
      : undefined;

  const items = await db
    .select({
      id: schema.contentDatabaseItems.id,
      documentId: schema.contentDatabaseItems.documentId,
    })
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, args.database.id),
        args.documentId
          ? eq(schema.contentDatabaseItems.documentId, args.documentId)
          : undefined,
        sql`exists (
          select 1 from ${schema.documents}
          where ${schema.documents.id} = ${schema.contentDatabaseItems.documentId}
            and ${schema.documents.trashedAt} is null
        )`,
      ),
    );
  const sourceIds = sources.map((source) => source.id);
  const sourceRows = await db
    .select({
      sourceId: schema.contentDatabaseSourceRows.sourceId,
      databaseItemId: schema.contentDatabaseSourceRows.databaseItemId,
      sourceRowId: schema.contentDatabaseSourceRows.sourceRowId,
      sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
    })
    .from(schema.contentDatabaseSourceRows)
    .where(
      and(
        inArray(schema.contentDatabaseSourceRows.sourceId, sourceIds),
        args.documentId
          ? eq(schema.contentDatabaseSourceRows.documentId, args.documentId)
          : undefined,
      ),
    );
  const records = await db
    .select()
    .from(schema.contentDatabaseBuilderAutosaves)
    .where(
      and(
        inArray(schema.contentDatabaseBuilderAutosaves.sourceId, [
          ...builderSources.keys(),
        ]),
        args.documentId
          ? eq(
              schema.contentDatabaseBuilderAutosaves.documentId,
              args.documentId,
            )
          : undefined,
      ),
    );
  const sourceRowsByItem = new Map<string, (typeof sourceRows)[number][]>();
  for (const row of sourceRows) {
    const list = sourceRowsByItem.get(row.databaseItemId) ?? [];
    list.push(row);
    sourceRowsByItem.set(row.databaseItemId, list);
  }
  const recordsByItem = new Map(
    records.map((record) => [record.databaseItemId, record]),
  );

  const rows: ArticleRow[] = [];
  for (const item of items) {
    const linked = sourceRowsByItem.get(item.id) ?? [];
    const builderRow = linked.find((row) => builderSources.has(row.sourceId));
    if (linked.length > 0 && !builderRow) continue;
    const source = builderRow
      ? builderSources.get(builderRow.sourceId)
      : onlySource;
    if (!source) continue;
    const record = recordsByItem.get(item.id) ?? null;
    const usableRecord = record?.sourceId === source.id ? record : null;
    rows.push({
      documentId: item.documentId,
      databaseId: args.database.id,
      databaseItemId: item.id,
      sourceId: source.id,
      entryId: builderRow?.sourceRowId ?? null,
      sourceValues: builderRow
        ? (parseRecord(builderRow.sourceValuesJson) as Record<
            string,
            DocumentPropertyValue
          > | null)
        : null,
      record: usableRecord,
      eligible: source.writable && (!!usableRecord || !builderRow),
    });
  }
  return { builderSources, rows };
}

function timeMs(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function autosaveStatus(args: {
  row: ArticleRow;
  editStamp: string | null;
  now: string;
}): BuilderArticleAutosaveStatus | null {
  const { row } = args;
  if (!row.eligible) return null;
  const record = row.record;
  const nowMs = Date.parse(args.now);
  if (
    row.entryId &&
    !builderArticleAutosaveAllowsPublication(row.sourceValues?.published, {
      entryExists: true,
    })
  ) {
    return {
      enabled: false,
      state: "review",
      reason: "published",
      error: null,
      lastSavedAt: record?.lastSavedAt ?? null,
      due: false,
      dueSoon: false,
      canSave: false,
    };
  }
  const enabled = record ? record.enabled === 1 : true;
  const state =
    record && STATES.has(record.state)
      ? (record.state as BuilderArticleAutosaveState)
      : "idle";
  const reason =
    record?.reason && REASONS.has(record.reason)
      ? (record.reason as BuilderArticleAutosaveReason)
      : null;
  const editMs = timeMs(args.editStamp);
  const dirty = record
    ? !!args.editStamp && args.editStamp > (record.savedEditAt ?? "")
    : editMs !== null &&
      nowMs - editMs <= BUILDER_ARTICLE_AUTOSAVE_NEW_ROW_WINDOW_MS;
  const quiet =
    editMs === null || nowMs - editMs >= BUILDER_ARTICLE_AUTOSAVE_QUIET_MS;
  const updatedMs = timeMs(record?.updatedAt) ?? 0;
  let due = false;
  let dueSoon = false;
  if (enabled) {
    if (state === "saving") {
      due = nowMs - updatedMs >= BUILDER_EXECUTION_CLAIM_TIMEOUT_MS;
    } else if (
      state === "waiting" ||
      (state === "review" && reason === "unconfirmed_save") ||
      (state === "failed" && reason === "builder_body_unreadable")
    ) {
      due = nowMs - updatedMs >= BUILDER_ARTICLE_AUTOSAVE_RECHECK_MS;
    } else if (state !== "failed" && state !== "review") {
      due = dirty && quiet;
      dueSoon = dirty && !quiet;
    }
  }
  return {
    enabled,
    state,
    reason,
    error: record?.lastError ?? null,
    lastSavedAt: record?.lastSavedAt ?? null,
    due,
    dueSoon,
    canSave: due || state === "failed",
  };
}

function rowStatus(
  row: ArticleRow,
  editStamp: string | null,
  now: string,
): BuilderArticleRowStatus {
  return {
    documentId: row.documentId,
    databaseId: row.databaseId,
    sourceId: row.sourceId,
    databaseItemId: row.databaseItemId,
    entryId: row.entryId,
    builderUrl: row.entryId ? builderEntryEditorUrl(row.entryId) : null,
    autosave: autosaveStatus({ row, editStamp, now }),
  };
}

async function withSaveAccess(
  database: DatabaseRecord,
  rows: BuilderArticleRowStatus[],
) {
  const candidates = rows
    .filter((row) => row.autosave?.canSave)
    .map((row) => row.documentId);
  if (candidates.length === 0) return rows;
  const access = await resolveAccessMany(
    "document",
    [database.documentId, ...candidates],
    undefined,
    { skipResourceBody: true },
  );
  const canEdit = (documentId: string) => {
    const role = access.get(documentId)?.role;
    return role !== undefined && roleSatisfies(role, "editor");
  };
  const collectionEditor = canEdit(database.documentId);
  return rows.map((row) =>
    row.autosave?.canSave && !(collectionEditor && canEdit(row.documentId))
      ? { ...row, autosave: { ...row.autosave, canSave: false } }
      : row,
  );
}

export async function listBuilderArticleRows(args: {
  database: DatabaseRecord;
  documentId?: string;
  now: string;
}) {
  const read = await readArticleRows(args);
  const { builderSources } = read;
  const visible = await accessibleDocumentIds(
    read.rows.map((row) => row.documentId),
  );
  const rows = read.rows.filter((row) => visible.has(row.documentId));
  const stamps = await readEditStamps(
    rows.filter((row) => row.eligible).map((row) => row.documentId),
  );
  return {
    sourceId:
      builderSources.size === 1
        ? (firstOf([...builderSources.keys()]) ?? null)
        : null,
    rows: await withSaveAccess(
      args.database,
      rows
        .filter((row) => row.entryId || row.eligible)
        .map((row) =>
          rowStatus(row, stamps.get(row.documentId) ?? null, args.now),
        ),
    ),
  };
}

export async function resolveArticleDatabase(
  documentId: string,
  databaseId?: string,
) {
  const db = getDb();
  const items = await db
    .select({ databaseId: schema.contentDatabaseItems.databaseId })
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, documentId),
        databaseId
          ? eq(schema.contentDatabaseItems.databaseId, databaseId)
          : undefined,
      ),
    );
  const databaseIds = [...new Set(items.map((item) => item.databaseId))];
  if (databaseIds.length === 0) return null;
  let candidates = databaseIds;
  if (!databaseId) {
    const sources = await db
      .select({ databaseId: schema.contentDatabaseSources.databaseId })
      .from(schema.contentDatabaseSources)
      .where(
        and(
          inArray(schema.contentDatabaseSources.databaseId, databaseIds),
          eq(schema.contentDatabaseSources.sourceType, "builder-cms"),
        ),
      );
    candidates = [...new Set(sources.map((source) => source.databaseId))];
  }
  if (candidates.length === 0) return null;
  const collections = await db
    .select({
      id: schema.contentDatabases.id,
      documentId: schema.contentDatabases.documentId,
    })
    .from(schema.contentDatabases)
    .where(
      and(
        inArray(schema.contentDatabases.id, candidates),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  const visible = await resolveAccessMany(
    "document",
    collections.map((collection) => collection.documentId),
    undefined,
    { skipResourceBody: true },
  );
  candidates = collections
    .filter((collection) => visible.has(collection.documentId))
    .map((collection) => collection.id);
  if (candidates.length > 1) {
    fail(
      "This article is in more than one Builder collection. Open it from the collection you want to save it from.",
      { errorCode: "builder_autosave_ambiguous_collection", statusCode: 409 },
    );
  }
  const candidate = firstOf(candidates);
  if (!candidate) return null;
  return resolveDatabaseForSourceMutation({ databaseId: candidate });
}

async function unsettledSaveId(row: ArticleRow) {
  const executions = await getDb()
    .select({ id: schema.contentDatabaseSourceExecutions.id })
    .from(schema.contentDatabaseSourceExecutions)
    .innerJoin(
      schema.contentDatabaseSourceChangeSets,
      eq(
        schema.contentDatabaseSourceChangeSets.id,
        schema.contentDatabaseSourceExecutions.changeSetId,
      ),
    )
    .where(
      and(
        eq(schema.contentDatabaseSourceChangeSets.sourceId, row.sourceId),
        eq(schema.contentDatabaseSourceChangeSets.documentId, row.documentId),
        eq(schema.contentDatabaseSourceChangeSets.direction, "outbound"),
        inArray(schema.contentDatabaseSourceExecutions.state, [
          ...BUILDER_ARTICLE_AUTOSAVE_UNSETTLED_EXECUTION_STATES,
        ]),
      ),
    )
    .orderBy(asc(schema.contentDatabaseSourceExecutions.createdAt))
    .limit(1);
  return firstOf(executions)?.id;
}

async function touchRecord(id: string, now: string) {
  await getDb()
    .update(schema.contentDatabaseBuilderAutosaves)
    .set({ updatedAt: now })
    .where(
      and(
        eq(schema.contentDatabaseBuilderAutosaves.id, id),
        isNull(schema.contentDatabaseBuilderAutosaves.attemptId),
      ),
    );
}

async function ensureRecord(row: ArticleRow, now: string) {
  if (row.record) return row.record.id;
  const id = builderAutosaveId(row.sourceId, row.databaseItemId);
  await getDb()
    .insert(schema.contentDatabaseBuilderAutosaves)
    .values({
      id,
      sourceId: row.sourceId,
      databaseItemId: row.databaseItemId,
      documentId: row.documentId,
      enabled: 1,
      state: "idle",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  return id;
}

async function claimRecord(
  row: ArticleRow,
  now: string,
  editStamp: string | null = null,
) {
  const id = await ensureRecord(row, now);
  const attemptId = randomUUID();
  const claimed = await getDb()
    .update(schema.contentDatabaseBuilderAutosaves)
    .set({
      state: "saving",
      attemptId,
      claimedEditAt: editStamp,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.contentDatabaseBuilderAutosaves.id, id),
        eq(schema.contentDatabaseBuilderAutosaves.enabled, 1),
        or(
          isNull(schema.contentDatabaseBuilderAutosaves.attemptId),
          lt(
            schema.contentDatabaseBuilderAutosaves.updatedAt,
            builderExecutionStaleBefore(now),
          ),
        ),
      ),
    )
    .returning({ id: schema.contentDatabaseBuilderAutosaves.id });
  return claimed.length > 0 ? { id, attemptId } : null;
}

async function finishRecord(args: {
  id: string;
  attemptId: string;
  outcome: SaveOutcome;
  savedEditAt: string | null;
  now: string;
}) {
  const { outcome } = args;
  await getDb()
    .update(schema.contentDatabaseBuilderAutosaves)
    .set({
      state: outcome.state,
      reason: outcome.reason ?? null,
      lastError: outcome.error ?? null,
      attemptId: null,
      updatedAt: args.now,
      ...(outcome.disable ? { enabled: 0 } : {}),
      ...((outcome.state === "saved" || outcome.state === "idle") &&
      !outcome.settledEarlier &&
      !outcome.moreToSave
        ? { savedEditAt: args.savedEditAt }
        : {}),
      ...(outcome.saved ? { lastSavedAt: args.now } : {}),
    })
    .where(
      and(
        eq(schema.contentDatabaseBuilderAutosaves.id, args.id),
        eq(schema.contentDatabaseBuilderAutosaves.attemptId, args.attemptId),
      ),
    );
}

export function assertBuilderArticleSource(
  row: ArticleRow,
  sourceId: string | undefined,
) {
  if (sourceId && sourceId !== row.sourceId) {
    fail(
      "This article's Builder source changed. Reload the page and try again.",
      { errorCode: "builder_autosave_source_changed", statusCode: 409 },
    );
  }
}

export async function setBuilderArticleAutosaveEnabled(args: {
  row: ArticleRow;
  enabled: boolean;
  now: string;
}) {
  const id = await ensureRecord(args.row, args.now);
  const state = args.row.record?.state;
  const resetState = args.enabled && state !== "saved" && state !== "saving";
  await getDb()
    .update(schema.contentDatabaseBuilderAutosaves)
    .set({
      enabled: args.enabled ? 1 : 0,
      updatedAt: args.now,
      ...(resetState ? { state: "idle", reason: null, lastError: null } : {}),
    })
    .where(eq(schema.contentDatabaseBuilderAutosaves.id, id));
}

export async function readBuilderArticleRow(args: {
  database: DatabaseRecord;
  documentId: string;
}) {
  const { rows } = await readArticleRows(args);
  return firstOf(rows) ?? null;
}

export async function builderArticleRowStatus(args: {
  database: DatabaseRecord;
  documentId: string;
  now: string;
}) {
  const row = await readBuilderArticleRow(args);
  if (!row) return null;
  const stamps = await readEditStamps(row.eligible ? [row.documentId] : []);
  const statuses = await withSaveAccess(args.database, [
    rowStatus(row, stamps.get(row.documentId) ?? null, args.now),
  ]);
  return firstOf(statuses) ?? null;
}

interface SaveOutcome {
  state: BuilderArticleAutosaveState;
  reason?: BuilderArticleAutosaveReason | null;
  error?: string | null;
  saved?: boolean;
  sent?: boolean;
  moreToSave?: boolean;
  disable?: boolean;
  settledEarlier?: boolean;
}

export interface BuilderArticleAutosaveDeps {
  now: () => string;
  resolveDatabase: (
    documentId: string,
    databaseId?: string,
  ) => Promise<DatabaseRecord | null>;
  assertCollectionEditor: (database: DatabaseRecord) => Promise<void>;
  assertPageEditor: (documentId: string) => Promise<void>;
  getSourceSnapshot: (args: {
    database: DatabaseRecord;
    sourceId: string;
    documentId: string;
    unreadBodies: Map<string, BuilderUnreadBody>;
  }) => Promise<ContentDatabaseSource | null>;
  prepareReview: (args: {
    databaseId: string;
    sourceId: string;
    changeSetIds: string[];
    documentIds: string[];
    pushModeConfirmation?: Exclude<ContentDatabaseSourcePushMode, "none">;
  }) => Promise<PrepareBuilderSourceReviewResponse>;
  execute: (args: ExecuteBuilderSourceExecutionRequest) => Promise<unknown>;
  refreshSource: (args: {
    databaseId: string;
    sourceId: string;
  }) => Promise<unknown>;
  readBody: (args: {
    sourceId: string;
    documentId: string;
  }) => Promise<unknown>;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The automatic save failed.";
}

function errorCode(error: unknown) {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === "string" ? code : null;
}

const OUTCOMES_BY_CODE = new Map<string, (message: string) => SaveOutcome>([
  [
    "builder_autosave_published",
    () => ({ state: "review", reason: "published", disable: true }),
  ],
  [
    "builder_autosave_needs_review",
    () => ({ state: "review", reason: "needs_review" }),
  ],
  [
    "builder_autosave_editor_changes",
    () => ({ state: "waiting", reason: "builder_editor_changes" }),
  ],
  [
    "builder_entry_changed_since_review",
    (message) => ({
      state: "failed",
      reason: "builder_changed",
      error: message,
    }),
  ],
  [
    "builder_entry_write_in_progress",
    () => ({ state: "waiting", reason: "another_save_running" }),
  ],
  [
    BUILDER_ARTICLE_AUTOSAVE_UNCONFIRMED_STOP.errorCode,
    () => ({ state: "review", reason: "unconfirmed_save" }),
  ],
]);

const OUTCOME_UNKNOWN =
  /wait for the recovery window|remote outcome is unknown|local reconciliation failed/i;

export function builderArticleAutosaveOutcomeForError(
  error: unknown,
): SaveOutcome {
  const message = errorMessage(error);
  const code = errorCode(error);
  const coded = code ? OUTCOMES_BY_CODE.get(code) : undefined;
  if (coded) return coded(message);
  if (OUTCOME_UNKNOWN.test(message)) {
    return { state: "waiting", reason: "checking_last_save" };
  }
  if (/already running/i.test(message)) {
    return { state: "waiting", reason: "another_save_running" };
  }
  return { state: "failed", reason: "save_failed", error: message };
}

function pushModeConfirmation(pushMode: ContentDatabaseSourcePushMode) {
  return pushMode === "none" ? {} : { pushModeConfirmation: pushMode };
}

function hasExecution(
  changeSet: ContentDatabaseSourceChangeSet,
  states: string[],
) {
  return changeSet.executions.some((execution) =>
    states.includes(execution.state),
  );
}

async function saveArticle(args: {
  database: DatabaseRecord;
  row: ArticleRow;
  deps: BuilderArticleAutosaveDeps;
}): Promise<SaveOutcome> {
  const { database, row, deps } = args;
  const { sourceId } = row;
  const unreadBodies = new Map<string, BuilderUnreadBody>();
  const snapshot = await deps.getSourceSnapshot({
    database,
    sourceId,
    documentId: row.documentId,
    unreadBodies,
  });
  if (!snapshot || snapshot.sourceType !== "builder-cms") {
    return {
      state: "failed",
      reason: "save_failed",
      error: "This collection's Builder source is gone.",
    };
  }
  const changeSets = snapshot.changeSets.filter(
    (changeSet) =>
      changeSet.direction === "outbound" &&
      changeSet.documentId === row.documentId,
  );

  const unsettledId = await unsettledSaveId(row);
  const unsettled = firstOf(
    changeSets.flatMap((changeSet) =>
      changeSet.executions
        .filter((execution) => execution.id === unsettledId)
        .map((execution) => ({ changeSet, execution })),
    ),
  );
  if (unsettled) {
    try {
      await deps.execute({
        databaseId: database.id,
        sourceId,
        changeSetId: unsettled.changeSet.id,
        idempotencyKey: unsettled.execution.idempotencyKey,
        ...pushModeConfirmation(unsettled.execution.pushMode),
      });
    } catch (error) {
      const outcome = builderArticleAutosaveOutcomeForError(error);
      return outcome.state === "failed"
        ? {
            state: "review",
            reason: "unconfirmed_save",
            error: outcome.error ?? null,
          }
        : outcome;
    }
    return { state: "saved", saved: true, settledEarlier: true };
  }

  const pending = changeSets.filter(
    (candidate) =>
      (candidate.state === "pending_push" ||
        candidate.state === "staged_revision" ||
        candidate.state === "approved") &&
      !hasExecution(candidate, ["succeeded"]),
  );
  const changeSet = firstOf(pending);
  const unreadBody = unreadBodies.get(row.documentId);
  if (!changeSet) {
    if (!unreadBody) {
      return { state: row.record?.lastSavedAt ? "saved" : "idle" };
    }
    return unreadBody.failed
      ? {
          state: "failed",
          reason: "builder_body_unreadable",
          error: unreadBody.error,
        }
      : { state: "waiting", reason: "builder_body_unread" };
  }
  const moreToSave = pending.length > 1 || !!unreadBody;
  const sourceRow = snapshot.rows.find(
    (candidate) => candidate.documentId === row.documentId,
  );
  if (
    changeSet.conflictState !== "none" ||
    readBuilderCmsEditConflicts(sourceRow?.sourceValues).state !== "none"
  ) {
    return { state: "review", reason: "edit_conflict" };
  }
  if (changeSet.stagedPublicationTransition) {
    return { state: "review", reason: "needs_review" };
  }
  const effect = resolveBuilderCmsWriteEffect({ source: snapshot, changeSet });
  if (!builderArticleAutosaveAllowsEffect(effect)) {
    return effect === "autosave"
      ? { state: "review", reason: "published", disable: true }
      : { state: "review", reason: "needs_review" };
  }

  const prepared = await deps.prepareReview({
    databaseId: database.id,
    sourceId,
    changeSetIds: [changeSet.id],
    documentIds: [row.documentId],
    ...pushModeConfirmation(
      resolveBuilderCmsExecutionPushMode({ source: snapshot, changeSet }),
    ),
  });
  const preparedId =
    prepared.preparedChangeSetMappings.find(
      (mapping) => mapping.requestedChangeSetId === changeSet.id,
    )?.preparedChangeSetId ?? changeSet.id;
  const reviewRow = prepared.review.rows.find(
    (candidate) => candidate.changeSetId === preparedId,
  );
  if (!reviewRow?.execution?.idempotencyKey) {
    return {
      state: "failed",
      reason: "save_failed",
      error:
        prepared.review.result.message || "Content couldn't prepare this save.",
    };
  }
  if (!builderArticleAutosaveAllowsEffect(reviewRow.effect)) {
    return { state: "review", reason: "needs_review" };
  }
  if (reviewRow.execution.state === "succeeded") {
    return { state: "saved", saved: true, moreToSave };
  }
  await deps.execute({
    databaseId: database.id,
    sourceId,
    changeSetId: preparedId,
    idempotencyKey: reviewRow.execution.idempotencyKey,
    ...pushModeConfirmation(prepared.review.pushMode),
  });
  return { state: "saved", saved: true, sent: true, moreToSave };
}

export async function runBuilderArticleAutosaveWithDeps(
  args: {
    documentId: string;
    retry?: boolean;
    databaseId?: string;
    sourceId?: string;
  },
  deps: BuilderArticleAutosaveDeps,
): Promise<BuilderArticleRowStatus> {
  await deps.assertPageEditor(args.documentId);
  const database = await deps.resolveDatabase(args.documentId, args.databaseId);
  if (!database) {
    fail("This page isn't a row in a collection.", {
      errorCode: "not_a_collection_row",
      statusCode: 404,
    });
  }
  await deps.assertCollectionEditor(database);
  const row = await readBuilderArticleRow({
    database,
    documentId: args.documentId,
  });
  const now = deps.now();
  const stampsBefore = await readEditStamps([args.documentId]);
  const current = row
    ? autosaveStatus({
        row,
        editStamp: stampsBefore.get(args.documentId) ?? null,
        now,
      })
    : null;
  if (!row || !current) {
    fail("Automatic saves are only for articles created in this collection.", {
      errorCode: "builder_autosave_not_available",
      statusCode: 409,
    });
  }
  assertBuilderArticleSource(row, args.sourceId);
  const status = async () => {
    const result = await builderArticleRowStatus({
      database,
      documentId: args.documentId,
      now: deps.now(),
    });
    if (!result) {
      fail("This article is no longer in the collection.", {
        errorCode: "not_a_collection_row",
        statusCode: 404,
      });
    }
    return result;
  };

  if (current.state === "review" && current.reason === "published") {
    const claim = await claimRecord(row, now);
    if (claim) {
      await finishRecord({
        ...claim,
        outcome: { state: "review", reason: "published", disable: true },
        savedEditAt: null,
        now,
      });
    }
    return status();
  }
  if (!current.enabled) return status();
  if (!args.retry && !current.due) return status();
  if (
    current.state === "review" &&
    current.reason === "unconfirmed_save" &&
    row.record &&
    (await unsettledSaveId(row)) !== undefined
  ) {
    await touchRecord(row.record.id, now);
    return status();
  }

  const editStamp = stampsBefore.get(args.documentId) ?? null;
  const abandoned = row.record?.attemptId ? row.record : null;
  const claim = await claimRecord(row, now, editStamp);
  if (!claim) return status();
  let outcome: SaveOutcome;
  try {
    if (
      args.retry &&
      (row.record?.reason === "builder_changed" ||
        row.record?.reason === "builder_body_unreadable")
    ) {
      await deps.refreshSource({
        databaseId: database.id,
        sourceId: row.sourceId,
      });
    }
    if (args.retry && row.record?.reason === "builder_body_unreadable") {
      await deps.readBody({
        sourceId: row.sourceId,
        documentId: row.documentId,
      });
    }
    outcome = await saveArticle({ database, row, deps });
  } catch (error) {
    outcome = builderArticleAutosaveOutcomeForError(error);
  }
  await finishRecord({
    ...claim,
    outcome,
    savedEditAt:
      abandoned && !outcome.sent
        ? (abandoned.claimedEditAt ?? abandoned.savedEditAt)
        : editStamp,
    now: deps.now(),
  });
  return status();
}
