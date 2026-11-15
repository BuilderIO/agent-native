import { createHash, randomUUID } from "node:crypto";

import {
  ActionContractError,
  isAgentConnectionRequiredError,
} from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { recordCreatedDocumentsHistory } from "../server/lib/document-history.js";
import {
  GitHubSourceDeadlineError,
  GitHubSourceError,
  readGitHubPullRequests,
  searchGitHubPullRequests,
} from "../server/lib/github-source-client.js";
import {
  GITHUB_PULL_REQUEST_COLUMNS,
  GITHUB_PULL_REQUESTS_MAX_ADDED,
  GITHUB_PULL_REQUESTS_MAX_SEARCH_ROWS,
  GITHUB_PULL_REQUESTS_SOURCE_TYPE,
  githubPullRequestKey,
  githubPullRequestsSourceName,
  githubPullRequestValues,
  githubPullRequestValuesSettled,
  githubPullRequestWebUrl,
  type GitHubPullRequestColumn,
  type GitHubPullRequestColumnKey,
  type GitHubPullRequestRecord,
  type GitHubPullRequestRef,
} from "../shared/github-pull-requests.js";
import {
  defaultPropertyOptions,
  normalizePropertyValueWithOptions,
  parsePropertyOptions,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptionColor,
  type DocumentPropertyOptions,
} from "../shared/properties.js";
import { bulkChunkSizeForColumnCount, chunks } from "./_batch-utils.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { ensureDocumentsFilesMembership } from "./_content-files.js";
import { mutateContentDatabaseSourceMetadata } from "./_database-source-utils.js";
import {
  githubPullRequestsMetadataRecord,
  githubPullRequestsSourceCapabilities,
  githubPullRequestsSourceId,
  readGitHubPullRequestsState,
  type GitHubPullRequestsState,
} from "./_github-pull-requests-metadata.js";
import {
  createAppendPositionAllocator,
  databaseItemsPositionScope,
  documentsPositionScope,
  nextAppendPosition,
  withPositionLock,
} from "./_position-utils.js";
import { nanoid } from "./_property-utils.js";
import { lockLifecycleGroup, trashDocumentSubtree } from "./delete-document.js";

type Db = ReturnType<typeof getDb>;
type DatabaseRow = typeof schema.contentDatabases.$inferSelect;
type DocumentRow = typeof schema.documents.$inferSelect;
type SourceRow = typeof schema.contentDatabaseSourceRows.$inferSelect;

export const GITHUB_PULL_REQUESTS_SYNC_OPERATION = "sync-github-pull-requests";
/** How long a running sync holds its lease; longer than any sync's budget. */
const SYNC_LEASE_MS = 2 * 60 * 1000;
/** Reserved key in a source row's values for the sync's own bookkeeping. */
const ROW_STATE_KEY = "$githubPullRequest";
/** How long adding by link waits on GitHub. */
const ADD_READ_BUDGET_MS = 10_000;
/** How long syncs can run out of time before the collection says so. */
const SLOW_SYNCS_SHOWN_AFTER_MS = 5 * 60 * 1000;
/** How many rows one Trash transaction moves, so its locks stay few. */
const TRASH_BATCH_ROWS = 50;

const OPTION_COLORS: DocumentPropertyOptionColor[] = [
  "blue",
  "green",
  "purple",
  "pink",
  "orange",
  "yellow",
  "red",
  "gray",
];

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function opaqueId(kind: string, value: string) {
  return `${kind}_${hash(value).slice(0, 32)}`;
}

/** Only sync writes these columns, so bad JSON is corruption and throws. */
function parseJsonObject(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * Reads GitHub as the person who linked the collection. Their connection is
 * saved under the workspace they linked it from, so a collection with no
 * workspace of its own, in a Personal space, reads through that one.
 */
async function readAsLinker<T>(
  state: Pick<GitHubPullRequestsState, "linkedBy" | "linkedOrgId">,
  orgId: string | null,
  run: () => Promise<T>,
): Promise<T> {
  const workspace = orgId ?? state.linkedOrgId;
  return await runWithRequestContext(
    { userEmail: state.linkedBy, ...(workspace ? { orgId: workspace } : {}) },
    run,
  );
}

function sourceFieldRowId(sourceId: string, key: string) {
  return opaqueId("content_source_field", `${sourceId}:${key}`);
}

interface PullRequestColumn {
  fieldId: string;
  propertyId: string;
  key: GitHubPullRequestColumnKey;
  type: GitHubPullRequestColumn["type"];
  options: DocumentPropertyOptions;
}

const COLUMN_BY_KEY = new Map(
  GITHUB_PULL_REQUEST_COLUMNS.map((column) => [column.key, column] as const),
);

/**
 * The collection's GitHub columns by key, and the keys whose column someone
 * removed, which stay removed rather than coming back.
 */
async function loadColumns(db: Db, sourceId: string) {
  const fields = await db
    .select({
      id: schema.contentDatabaseSourceFields.id,
      key: schema.contentDatabaseSourceFields.sourceFieldKey,
      propertyId: schema.contentDatabaseSourceFields.propertyId,
    })
    .from(schema.contentDatabaseSourceFields)
    .where(
      and(
        eq(schema.contentDatabaseSourceFields.sourceId, sourceId),
        eq(schema.contentDatabaseSourceFields.mappingType, "property"),
      ),
    );
  const propertyIds = fields
    .map((field) => field.propertyId)
    .filter((id): id is string => !!id);
  const properties = propertyIds.length
    ? await db
        .select({
          id: schema.documentPropertyDefinitions.id,
          type: schema.documentPropertyDefinitions.type,
          optionsJson: schema.documentPropertyDefinitions.optionsJson,
        })
        .from(schema.documentPropertyDefinitions)
        .where(inArray(schema.documentPropertyDefinitions.id, propertyIds))
    : [];
  const propertyById = new Map(
    properties.map((property) => [property.id, property] as const),
  );
  const columns = new Map<GitHubPullRequestColumnKey, PullRequestColumn>();
  const removed = new Set<string>();
  for (const field of fields) {
    const spec = COLUMN_BY_KEY.get(field.key as GitHubPullRequestColumnKey);
    const property = field.propertyId
      ? propertyById.get(field.propertyId)
      : undefined;
    if (!spec || !property || property.type !== spec.type) {
      removed.add(field.key);
      continue;
    }
    columns.set(spec.key, {
      fieldId: field.id,
      propertyId: property.id,
      key: spec.key,
      type: spec.type,
      options: parsePropertyOptions(property.optionsJson),
    });
  }
  return { columns, removed };
}

async function insertColumn(
  tx: Db,
  args: {
    database: DatabaseRow;
    sourceId: string;
    spec: GitHubPullRequestColumn;
    now: string;
  },
): Promise<PullRequestColumn> {
  const maxPosition = rowAt(
    await tx
      .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
      .from(schema.documentPropertyDefinitions)
      .where(
        eq(schema.documentPropertyDefinitions.databaseId, args.database.id),
      ),
  );
  const propertyId = nanoid();
  // A select's choices are its fixed ones, or grow from the values, so it
  // starts without the placeholder option Content gives columns made by hand.
  const options: DocumentPropertyOptions =
    args.spec.type === "select"
      ? {
          options: (args.spec.options ?? []).map((option) => ({ ...option })),
        }
      : defaultPropertyOptions(args.spec.type);
  await tx.insert(schema.documentPropertyDefinitions).values({
    id: propertyId,
    ownerEmail: args.database.ownerEmail,
    orgId: args.database.orgId ?? null,
    databaseId: args.database.id,
    name: args.spec.name,
    type: args.spec.type,
    optionsJson: serializePropertyOptions(options),
    position: nextAppendPosition(maxPosition?.max),
    createdAt: args.now,
    updatedAt: args.now,
  });
  const fieldId = sourceFieldRowId(args.sourceId, args.spec.key);
  await tx
    .insert(schema.contentDatabaseSourceFields)
    .values({
      id: fieldId,
      ownerEmail: args.database.ownerEmail,
      sourceId: args.sourceId,
      propertyId,
      localFieldKey: propertyId,
      sourceFieldKey: args.spec.key,
      sourceFieldLabel: args.spec.name,
      sourceFieldType: args.spec.type,
      mappingType: "property",
      writeOwner: "source",
      readOnly: 1,
      provenance: "github pull request",
      freshness: "fresh",
      lastSyncedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing();
  return {
    fieldId,
    propertyId,
    key: args.spec.key,
    type: args.spec.type,
    options,
  };
}

/** Adds the columns a collection is missing, other than ones someone removed. */
async function ensureColumns(
  tx: Db,
  args: {
    database: DatabaseRow;
    sourceId: string;
    columns: Map<GitHubPullRequestColumnKey, PullRequestColumn>;
    removed: Set<string>;
    now: string;
  },
) {
  for (const spec of GITHUB_PULL_REQUEST_COLUMNS) {
    if (args.columns.has(spec.key) || args.removed.has(spec.key)) continue;
    args.columns.set(
      spec.key,
      await insertColumn(tx, {
        database: args.database,
        sourceId: args.sourceId,
        spec,
        now: args.now,
      }),
    );
  }
}

/** Adds any select options the values name, so their stored ids resolve. */
async function ensureOptions(
  tx: Db,
  column: PullRequestColumn,
  values: unknown[],
  now: string,
) {
  if (column.type !== "select") return;
  const options = [...(column.options.options ?? [])];
  const known = new Set(
    options.map((option) => option.name.trim().toLowerCase()),
  );
  const usedIds = new Set(options.map((option) => option.id));
  const fixed = COLUMN_BY_KEY.get(column.key)?.options ?? [];
  let added = false;
  for (const raw of values) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const name = raw.trim();
    if (known.has(name.toLowerCase())) continue;
    known.add(name.toLowerCase());
    // A fixed choice someone deleted comes back with its own color.
    const preset = fixed.find((option) => option.name === name);
    const base =
      preset?.id ??
      (name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") ||
        "option");
    let id = base;
    for (let index = 2; usedIds.has(id); index++) id = `${base}-${index}`;
    usedIds.add(id);
    options.push({
      id,
      name,
      color:
        preset?.color ??
        rowAt(OPTION_COLORS, options.length % OPTION_COLORS.length) ??
        "gray",
    });
    added = true;
  }
  if (!added) return;
  column.options = { ...column.options, options };
  await tx
    .update(schema.documentPropertyDefinitions)
    .set({
      optionsJson: serializePropertyOptions(column.options),
      updatedAt: now,
    })
    .where(eq(schema.documentPropertyDefinitions.id, column.propertyId));
}

interface RowState {
  key: string;
  /** Hash of the title and values the row was written with. */
  hash: string;
}

function rowState(row: Pick<SourceRow, "sourceValuesJson">): RowState | null {
  const state = parseJsonObject(row.sourceValuesJson)[ROW_STATE_KEY];
  if (!state || typeof state !== "object") return null;
  const value = state as Record<string, unknown>;
  return typeof value.key === "string"
    ? { key: value.key, hash: typeof value.hash === "string" ? value.hash : "" }
    : null;
}

/** What one pull request's row should hold now. */
interface PlannedRow {
  key: string;
  pullRequest: GitHubPullRequestRecord;
  values: Record<GitHubPullRequestColumnKey, unknown>;
  hash: string;
}

function planRow(
  pullRequest: GitHubPullRequestRecord,
  now: number,
): PlannedRow {
  const values = githubPullRequestValues(pullRequest, now);
  return {
    key: githubPullRequestKey(pullRequest),
    pullRequest,
    values,
    hash: hash(JSON.stringify([pullRequest.title, values])),
  };
}

interface RowWrite {
  db: Db;
  database: DatabaseRow;
  databaseDocument: DocumentRow;
  sourceId: string;
  actor: string;
  now: string;
  columns: Map<GitHubPullRequestColumnKey, PullRequestColumn>;
}

function columnValue(column: PullRequestColumn, row: PlannedRow) {
  return normalizePropertyValueWithOptions(
    column.type,
    row.values[column.key],
    column.options,
  );
}

function sourceRowFields(
  write: RowWrite,
  row: PlannedRow,
  ids: { itemId: string; documentId: string },
) {
  const pr = row.pullRequest;
  return {
    sourceId: write.sourceId,
    databaseItemId: ids.itemId,
    documentId: ids.documentId,
    sourceRowId: row.key,
    sourceQualifiedId: githubPullRequestWebUrl(pr),
    sourceDisplayKey: `${pr.owner}/${pr.repo}#${pr.number}`,
    sourceValuesJson: JSON.stringify({
      title: pr.title,
      ...row.values,
      [ROW_STATE_KEY]: { key: row.key, hash: row.hash } satisfies RowState,
    }),
    provenance: "github",
    syncState: "linked",
    freshness: "fresh",
    lastSyncedAt: write.now,
    lastSourceUpdatedAt: pr.updatedAt,
    updatedAt: write.now,
  };
}

/**
 * The row at `index`, or undefined past the end. Indexing alone types a
 * missing row as present.
 */
export function rowAt<T>(rows: readonly T[], index = 0): T | undefined {
  return rows[index];
}

/**
 * Writes rows a few statements at a time rather than one a row, each small
 * enough for SQLite's cap on the values one statement carries.
 */
async function inStatements<T extends object>(
  rows: T[],
  write: (rows: T[]) => Promise<unknown>,
) {
  const first = rowAt(rows);
  if (!first) return;
  const size = bulkChunkSizeForColumnCount(Object.keys(first).length);
  for (const chunk of chunks(rows, size)) await write(chunk);
}

async function takenDocumentIds(db: Db, ids: string[]) {
  const taken = new Set<string>();
  for (const chunk of chunks(ids, bulkChunkSizeForColumnCount(1))) {
    // guard:allow-unscoped — page ids are unique across every owner, so a
    // new page's id must be free of all of them. Only ids are read.
    const rows = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(inArray(schema.documents.id, chunk));
    for (const row of rows as Array<{ id: string }>) taken.add(row.id);
  }
  return taken;
}

/** A new row with the page and collection item ids it gets. */
interface PlacedRow {
  row: PlannedRow;
  documentId: string;
  itemId: string;
}

/**
 * The page id each new row gets. It follows the pull request, so a retry
 * makes the same page; when a page left behind has it, like one in Trash
 * after the pull request left the search, the next free one after it.
 */
async function placeNewRows(
  db: Db,
  sourceId: string,
  rows: PlannedRow[],
): Promise<PlacedRow[]> {
  const placed: PlacedRow[] = [];
  let unsettled = rows;
  for (let attempt = 0; unsettled.length > 0; attempt++) {
    const candidates = unsettled.map((row) => ({
      row,
      documentId: opaqueId(
        "content_github_pr_page",
        `${sourceId}:${row.key}${attempt > 0 ? `:${attempt}` : ""}`,
      ),
    }));
    const taken = await takenDocumentIds(
      db,
      candidates.map((candidate) => candidate.documentId),
    );
    unsettled = [];
    for (const candidate of candidates) {
      if (taken.has(candidate.documentId)) {
        unsettled.push(candidate.row);
      } else {
        placed.push({
          ...candidate,
          itemId: opaqueId(
            "content_github_pr_item",
            `${sourceId}:${candidate.documentId}`,
          ),
        });
      }
    }
  }
  return placed;
}

/**
 * Adds new pull requests' pages to the collection, a statement a table: the
 * pages and their rows after the rows already there, the collection's
 * shares, History's first checkpoint, the column values, and the records
 * that tie each page to its pull request. The caller holds the lock.
 */
async function insertRows(tx: Db, write: RowWrite, rows: PlannedRow[]) {
  if (rows.length === 0) return;
  const placed = await placeNewRows(tx, write.sourceId, rows);
  const documentIds = placed.map((entry) => entry.documentId);
  const maxDocument = rowAt(
    await tx
      .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, write.database.ownerEmail),
          eq(schema.documents.parentId, write.database.documentId),
        ),
      ),
  );
  const maxItem = rowAt(
    await tx
      .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, write.database.id)),
  );
  const documentPosition = createAppendPositionAllocator(maxDocument?.max);
  const itemPosition = createAppendPositionAllocator(maxItem?.max);
  await inStatements(
    placed.map(({ row, documentId }) => ({
      id: documentId,
      spaceId: write.database.spaceId ?? write.databaseDocument.spaceId,
      ownerEmail: write.database.ownerEmail,
      orgId: write.database.orgId,
      parentId: write.database.documentId,
      title: row.pullRequest.title,
      content: "",
      description: "",
      icon: null,
      position: documentPosition(),
      isFavorite: 0,
      hideFromSearch: write.databaseDocument.hideFromSearch,
      visibility: write.databaseDocument.visibility,
      createdBy: write.actor,
      updatedBy: write.actor,
      createdAt: write.now,
      updatedAt: write.now,
    })),
    (values) => tx.insert(schema.documents).values(values),
  );
  await inStatements(
    placed.map(({ documentId, itemId }) => ({
      id: itemId,
      ownerEmail: write.database.ownerEmail,
      orgId: write.database.orgId,
      databaseId: write.database.id,
      documentId,
      position: itemPosition(),
      createdAt: write.now,
      updatedAt: write.now,
    })),
    (values) => tx.insert(schema.contentDatabaseItems).values(values),
  );
  const shares = await tx
    .select({
      principalType: schema.documentShares.principalType,
      principalId: schema.documentShares.principalId,
      role: schema.documentShares.role,
    })
    .from(schema.documentShares)
    .where(eq(schema.documentShares.resourceId, write.database.documentId));
  await inStatements(
    documentIds.flatMap((documentId) =>
      shares.map((share) => ({
        id: nanoid(),
        resourceId: documentId,
        principalType: share.principalType,
        principalId: share.principalId,
        role: share.role,
        createdBy: write.actor,
        createdAt: write.now,
      })),
    ),
    (values) => tx.insert(schema.documentShares).values(values),
  );
  await ensureDocumentsFilesMembership(
    tx,
    documentIds,
    write.now,
    write.database.ownerEmail,
  );
  await recordCreatedDocumentsHistory({
    db: tx,
    ownerEmail: write.database.ownerEmail,
    documents: placed.map(({ row, documentId }) => ({
      documentId,
      title: row.pullRequest.title,
      content: "",
      cause: {
        groupId: `github-pull-requests:${write.sourceId}:${write.now}:${documentId}`,
        groupKind: "operation",
        actorKind: "source",
        actorEmail: null,
        origin: "github",
        operation: GITHUB_PULL_REQUESTS_SYNC_OPERATION,
      },
    })),
    now: write.now,
  });
  const columns = [...write.columns.values()];
  for (const column of columns) {
    await ensureOptions(
      tx,
      column,
      rows.map((row) => row.values[column.key]),
      write.now,
    );
  }
  await inStatements(
    placed.flatMap(({ row, documentId }) =>
      columns.flatMap((column) => {
        const normalized = columnValue(column, row);
        return normalized === null
          ? []
          : [
              {
                id: nanoid(),
                ownerEmail: write.database.ownerEmail,
                documentId,
                propertyId: column.propertyId,
                valueJson: serializePropertyValue(normalized),
                createdAt: write.now,
                updatedAt: write.now,
              },
            ];
      }),
    ),
    (values) => tx.insert(schema.documentPropertyValues).values(values),
  );
  await inStatements(
    placed.map(({ row, documentId, itemId }) => ({
      id: opaqueId("content_source_row", `${write.sourceId}:${documentId}`),
      ownerEmail: write.database.ownerEmail,
      createdAt: write.now,
      ...sourceRowFields(write, row, { itemId, documentId }),
    })),
    (values) => tx.insert(schema.contentDatabaseSourceRows).values(values),
  );
}

/** A linked row whose pull request changed, with its page's title now. */
interface RowChange {
  existing: SourceRow;
  row: PlannedRow;
  title: string;
}

/**
 * Brings changed rows' titles and values up to their pull requests, a few
 * statements at a time, since Days open changes every day for every open
 * pull request. Returns how many rows changed.
 */
async function updateRows(
  tx: Db,
  write: RowWrite,
  changes: RowChange[],
): Promise<number> {
  if (!changes.length) return 0;
  const changed = new Set<string>();
  for (const { existing, row, title } of changes) {
    // GitHub owns the title, so a rename in Content goes back at the next sync.
    if (title === row.pullRequest.title) continue;
    await tx
      .update(schema.documents)
      .set({ title: row.pullRequest.title, updatedAt: write.now })
      .where(
        and(
          eq(schema.documents.id, existing.documentId),
          eq(schema.documents.ownerEmail, write.database.ownerEmail),
        ),
      );
    changed.add(existing.id);
  }
  const columns = [...write.columns.values()];
  for (const column of columns) {
    await ensureOptions(
      tx,
      column,
      changes.map(({ row }) => row.values[column.key]),
      write.now,
    );
  }
  const stored = new Map<
    string,
    typeof schema.documentPropertyValues.$inferSelect
  >();
  if (columns.length) {
    const propertyIds = columns.map((column) => column.propertyId);
    const documentIds = changes.map(({ existing }) => existing.documentId);
    for (const chunk of chunks(
      documentIds,
      bulkChunkSizeForColumnCount(1) - propertyIds.length,
    )) {
      const values = await tx
        .select()
        .from(schema.documentPropertyValues)
        .where(
          and(
            inArray(schema.documentPropertyValues.documentId, chunk),
            inArray(schema.documentPropertyValues.propertyId, propertyIds),
          ),
        );
      for (const value of values) {
        stored.set(`${value.documentId}:${value.propertyId}`, value);
      }
    }
  }
  const upserts: Array<typeof schema.documentPropertyValues.$inferInsert> = [];
  const deletes: string[] = [];
  for (const { existing, row } of changes) {
    for (const column of columns) {
      const normalized = columnValue(column, row);
      const current = stored.get(`${existing.documentId}:${column.propertyId}`);
      if (normalized === null) {
        if (current) {
          deletes.push(current.id);
          changed.add(existing.id);
        }
        continue;
      }
      const valueJson = serializePropertyValue(normalized);
      if (current?.valueJson === valueJson) continue;
      changed.add(existing.id);
      upserts.push({
        id: current?.id ?? nanoid(),
        ownerEmail: write.database.ownerEmail,
        documentId: existing.documentId,
        propertyId: column.propertyId,
        valueJson,
        createdAt: current?.createdAt ?? write.now,
        updatedAt: write.now,
      });
    }
  }
  await inStatements(upserts, (values) =>
    tx
      .insert(schema.documentPropertyValues)
      .values(values)
      .onConflictDoUpdate({
        target: schema.documentPropertyValues.id,
        set: {
          valueJson: sql`excluded.value_json`,
          updatedAt: sql`excluded.updated_at`,
        },
      }),
  );
  for (const chunk of chunks(deletes, bulkChunkSizeForColumnCount(1))) {
    await tx
      .delete(schema.documentPropertyValues)
      .where(inArray(schema.documentPropertyValues.id, chunk));
  }
  await inStatements(
    changes.map(({ existing, row }) => ({
      ...existing,
      ...sourceRowFields(write, row, {
        itemId: existing.databaseItemId,
        documentId: existing.documentId,
      }),
    })),
    (values) =>
      tx
        .insert(schema.contentDatabaseSourceRows)
        .values(values)
        .onConflictDoUpdate({
          target: schema.contentDatabaseSourceRows.id,
          set: {
            sourceQualifiedId: sql`excluded.source_qualified_id`,
            sourceDisplayKey: sql`excluded.source_display_key`,
            sourceValuesJson: sql`excluded.source_values_json`,
            provenance: sql`excluded.provenance`,
            syncState: sql`excluded.sync_state`,
            freshness: sql`excluded.freshness`,
            lastSyncedAt: sql`excluded.last_synced_at`,
            lastSourceUpdatedAt: sql`excluded.last_source_updated_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
  );
  return changed.size;
}

/** Each page's title, in one read rather than one a row. */
async function documentTitles(
  db: Db,
  ownerEmail: string,
  documentIds: string[],
) {
  const titles = new Map<string, string>();
  for (const chunk of chunks(documentIds, bulkChunkSizeForColumnCount(1))) {
    const rows = await db
      .select({ id: schema.documents.id, title: schema.documents.title })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, ownerEmail),
          inArray(schema.documents.id, chunk),
        ),
      );
    for (const row of rows) titles.set(row.id, row.title);
  }
  return titles;
}

async function readSourceRows(db: Db, sourceId: string) {
  const rows = (await db
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(
      eq(schema.contentDatabaseSourceRows.sourceId, sourceId),
    )) as SourceRow[];
  const byKey = new Map<string, SourceRow>();
  for (const row of rows) {
    const key = rowState(row)?.key ?? row.sourceRowId;
    if (key) byKey.set(key, row);
  }
  return byKey;
}

interface LoadedSource {
  source: typeof schema.contentDatabaseSources.$inferSelect;
  database: DatabaseRow;
  databaseDocument: DocumentRow;
  state: GitHubPullRequestsState;
}

async function readSource(sourceId: string): Promise<LoadedSource | null> {
  const target = rowAt(
    await getDb()
      .select({
        source: schema.contentDatabaseSources,
        database: schema.contentDatabases,
        databaseDocument: schema.documents,
      })
      .from(schema.contentDatabaseSources)
      .innerJoin(
        schema.contentDatabases,
        eq(
          schema.contentDatabases.id,
          schema.contentDatabaseSources.databaseId,
        ),
      )
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabases.documentId),
      )
      .where(eq(schema.contentDatabaseSources.id, sourceId)),
  );
  if (
    !target ||
    target.source.sourceType !== GITHUB_PULL_REQUESTS_SOURCE_TYPE
  ) {
    return null;
  }
  const state = readGitHubPullRequestsState(
    parseJsonObject(target.source.metadataJson),
  );
  return state ? { ...target, state } : null;
}

/** The pull request link on a collection, if it has one. */
export async function readLinkedGitHubPullRequests(databaseId: string) {
  const source = rowAt(
    await getDb()
      .select({ id: schema.contentDatabaseSources.id })
      .from(schema.contentDatabaseSources)
      .where(
        and(
          eq(schema.contentDatabaseSources.databaseId, databaseId),
          eq(
            schema.contentDatabaseSources.sourceType,
            GITHUB_PULL_REQUESTS_SOURCE_TYPE,
          ),
        ),
      )
      .limit(1),
  );
  return source ? await readSource(source.id) : null;
}

/** Applies a change to the link's state, merged into whatever is stored now. */
async function updateState(
  sourceId: string,
  now: string,
  change: (state: GitHubPullRequestsState) => GitHubPullRequestsState | null,
  columns: (state: GitHubPullRequestsState) => Partial<{
    sourceName: string;
    syncState: string;
    freshness: string;
    lastRefreshedAt: string;
    lastSourceUpdatedAt: string;
    lastError: string | null;
  }> = () => ({}),
) {
  await mutateContentDatabaseSourceMetadata({
    sourceId,
    now,
    buildPatch: (current) => {
      const metadata = parseJsonObject(current.metadataJson);
      const state = readGitHubPullRequestsState(metadata);
      const next = state ? change(state) : null;
      if (!next) return { metadataJson: current.metadataJson };
      return {
        metadataJson: JSON.stringify({
          ...metadata,
          ...githubPullRequestsMetadataRecord(next),
        }),
        ...columns(next),
      };
    },
  });
}

async function claimSync(
  sourceId: string,
  now: string,
): Promise<string | null> {
  const claimId = randomUUID();
  // Set by the update below, which runs before it returns.
  const claim = { won: false };
  await updateState(
    sourceId,
    now,
    (state) => {
      claim.won = false;
      if (state.claim && Date.parse(state.claim.until) > Date.parse(now)) {
        return null;
      }
      claim.won = true;
      return {
        ...state,
        claim: {
          id: claimId,
          until: new Date(Date.parse(now) + SYNC_LEASE_MS).toISOString(),
        },
      };
    },
    () => ({ syncState: "refreshing" }),
  );
  return claim.won ? claimId : null;
}

/** Waits, at most until `until`, for the sync holding the link's lease to end. */
export async function waitForGitHubPullRequestsSync(
  sourceId: string,
  until: number,
) {
  for (;;) {
    const claim = (await readSource(sourceId))?.state.claim;
    const left = until - Date.now();
    if (!claim || Date.parse(claim.until) <= Date.now() || left <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, left)));
  }
}

/**
 * Takes the collection's lock, then reads the link as it stands. A sync
 * passes its lease, and stops when the link was disconnected or another sync
 * took over. Updating the link's row, not only reading it, holds it until
 * the write commits.
 */
async function lockLink(
  tx: Db,
  database: DatabaseRow,
  sourceId: string,
  claimId?: string,
) {
  await lockContentDatabaseMutation(tx, database.id);
  const source = rowAt(
    await tx
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: sql`${schema.contentDatabaseSources.updatedAt}` })
      .where(eq(schema.contentDatabaseSources.id, sourceId))
      .returning({ metadataJson: schema.contentDatabaseSources.metadataJson }),
  );
  const state = source
    ? readGitHubPullRequestsState(parseJsonObject(source.metadataJson))
    : null;
  if (!state) {
    throw new ActionContractError(
      "This collection isn't linked to GitHub pull requests.",
      { errorCode: "SOURCE_NOT_FOUND", statusCode: 404 },
    );
  }
  if (claimId && state.claim?.id !== claimId) {
    throw new ActionContractError(
      "This sync stopped because another sync took over, which brings the collection up to date.",
      { errorCode: "SYNC_SUPERSEDED", statusCode: 409 },
    );
  }
  return state;
}

function withAppendPositions<T>(
  database: DatabaseRow,
  write: () => Promise<T>,
) {
  return withPositionLock(
    documentsPositionScope(database.ownerEmail, database.documentId),
    () => withPositionLock(databaseItemsPositionScope(database.id), write),
  );
}

/**
 * Makes the collection's rows match these pull requests, in one transaction:
 * new ones get pages, changed ones are brought up to date. Returns the row
 * each pull request has now, by key, and the counts.
 */
async function writeRows(args: {
  loaded: LoadedSource;
  pullRequests: GitHubPullRequestRecord[];
  now: string;
  claimId?: string;
}) {
  const { database, databaseDocument, source, state } = args.loaded;
  const planned = new Map<string, PlannedRow>();
  for (const pullRequest of args.pullRequests) {
    const row = planRow(pullRequest, Date.parse(args.now));
    planned.set(row.key, row);
  }
  const db = getDb();
  return await withAppendPositions(database, () =>
    db.transaction(async (tx: Db) => {
      const current = await lockLink(tx, database, source.id, args.claimId);
      const { columns, removed } = await loadColumns(tx, source.id);
      await ensureColumns(tx, {
        database,
        sourceId: source.id,
        columns,
        removed,
        now: args.now,
      });
      const write: RowWrite = {
        db: tx,
        database,
        databaseDocument,
        sourceId: source.id,
        actor: current.linkedBy || state.linkedBy,
        now: args.now,
        columns,
      };
      // Read under the lock, so a row another add or sync just wrote isn't
      // written twice.
      const existing = await readSourceRows(tx, source.id);
      const titles = await documentTitles(
        tx,
        database.ownerEmail,
        [...planned.keys()].flatMap((key) => {
          const linked = existing.get(key);
          return linked ? [linked.documentId] : [];
        }),
      );
      const fresh: PlannedRow[] = [];
      const changes: RowChange[] = [];
      // Records whose pages were deleted from Trash, which get new pages.
      const gone: string[] = [];
      for (const row of planned.values()) {
        const linked = existing.get(row.key);
        const title = linked && titles.get(linked.documentId);
        if (!linked || title === undefined) {
          if (linked) gone.push(linked.id);
          fresh.push(row);
          continue;
        }
        if (
          rowState(linked)?.hash === row.hash &&
          title === row.pullRequest.title
        ) {
          continue;
        }
        changes.push({ existing: linked, row, title });
      }
      const updated = await updateRows(tx, write, changes);
      for (const chunk of chunks(gone, bulkChunkSizeForColumnCount(1))) {
        await tx
          .delete(schema.contentDatabaseSourceRows)
          .where(inArray(schema.contentDatabaseSourceRows.id, chunk));
      }
      await insertRows(tx, write, fresh);
      const rows = await readSourceRows(tx, source.id);
      return { created: fresh.length, updated, rows };
    }),
  );
}

/**
 * Moves rows whose pull requests left the search to Trash, a batch to a
 * transaction, skipping any added by link since the sync read the link.
 * Returns how many moved.
 */
async function trashRows(
  loaded: LoadedSource,
  leaving: Array<{ key: string; row: SourceRow }>,
  now: string,
  claimId: string,
): Promise<number> {
  const { ownerEmail } = loaded.database;
  let moved = 0;
  for (const batch of chunks(leaving, TRASH_BATCH_ROWS)) {
    moved += await getDb().transaction(async (tx: Db) => {
      // The pages' other collections may sort before this one, so the whole
      // group is locked in order before the link check takes this collection.
      const locks = await lockLifecycleGroup(tx, {
        operation: "trash",
        roots: batch.map(({ row }) => ({ id: row.documentId, ownerEmail })),
        alsoLockDatabaseIds: [loaded.database.id],
      });
      const state = await lockLink(
        tx,
        loaded.database,
        loaded.source.id,
        claimId,
      );
      const added = new Set(state.added);
      const candidates = batch.filter(({ key }) => !added.has(key));
      if (!candidates.length) return 0;
      const records = await tx
        .select({
          id: schema.contentDatabaseSourceRows.id,
          documentId: schema.contentDatabaseSourceRows.documentId,
        })
        .from(schema.contentDatabaseSourceRows)
        .where(
          inArray(
            schema.contentDatabaseSourceRows.id,
            candidates.map(({ row }) => row.id),
          ),
        );
      const linked = new Set(
        records.map((record) => `${record.id}:${record.documentId}`),
      );
      const going = candidates.filter(({ row }) =>
        linked.has(`${row.id}:${row.documentId}`),
      );
      if (!going.length) return 0;
      const live = new Set(
        (
          await tx
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(
              and(
                inArray(
                  schema.documents.id,
                  going.map(({ row }) => row.documentId),
                ),
                eq(schema.documents.ownerEmail, ownerEmail),
                isNull(schema.documents.trashedAt),
              ),
            )
        ).map((document) => document.id),
      );
      let count = 0;
      for (const { row } of going) {
        if (!live.has(row.documentId)) continue;
        await trashDocumentSubtree(
          tx,
          row.documentId,
          ownerEmail,
          now,
          locks,
          "github",
        );
        count += 1;
      }
      await tx.delete(schema.contentDatabaseSourceRows).where(
        inArray(
          schema.contentDatabaseSourceRows.id,
          going.map(({ row }) => row.id),
        ),
      );
      return count;
    });
  }
  return moved;
}

export interface GitHubPullRequestsSyncResult {
  state: "synced" | "busy" | "error";
  created: number;
  updated: number;
  trashed: number;
  rows: number;
  searchTotal: number | null;
  problem: GitHubPullRequestsState["problem"];
}

function emptyResult(
  state: GitHubPullRequestsSyncResult["state"],
  problem: GitHubPullRequestsState["problem"] = null,
): GitHubPullRequestsSyncResult {
  return {
    state,
    created: 0,
    updated: 0,
    trashed: 0,
    rows: 0,
    searchTotal: null,
    problem,
  };
}

export function githubPullRequestsSyncChangedRows(
  result: GitHubPullRequestsSyncResult,
) {
  return result.created + result.updated + result.trashed > 0;
}

function problemFrom(
  error: unknown,
  now: string,
): NonNullable<GitHubPullRequestsState["problem"]> | null {
  if (error instanceof GitHubSourceError) {
    return {
      code:
        error.code === "connection" ||
        error.code === "forbidden" ||
        error.code === "rate_limited"
          ? error.code
          : "unavailable",
      message: error.message,
      at: now,
    };
  }
  if (isAgentConnectionRequiredError(error)) {
    return {
      code: "connection",
      message:
        "GitHub isn't connected for the person who linked these pull requests. Reconnect GitHub, then refresh.",
      at: now,
    };
  }
  return null;
}

function tooManyResults(
  total: number,
  now: string,
): NonNullable<GitHubPullRequestsState["problem"]> {
  return {
    code: "too_many_results",
    message: `The search finds ${total} pull requests, and a collection follows the first ${GITHUB_PULL_REQUESTS_MAX_SEARCH_ROWS}. Narrow the search to see the rest; rows it no longer finds stay until then.`,
    at: now,
  };
}

function warnLeaseNotReleased(error: unknown) {
  console.warn(
    "[github-pull-requests] couldn't release the sync's lease:",
    error instanceof Error ? error.message : String(error),
  );
}

export interface SyncGitHubPullRequestsOptions {
  sourceId: string;
  /** End any GitHub request still waiting after this long; the next sync tries again. */
  budgetMs: number;
  /** Rethrow a missing GitHub connection so an interactive caller can offer to connect. */
  throwConnectionErrors?: boolean;
  /** Rethrow a failure the sync can't name, once it's on the link. */
  throwUnexpectedErrors?: boolean;
  /** Ends the sync early, as its time budget would, such as when the server stops. */
  signal?: AbortSignal;
}

/**
 * Brings a linked collection up to GitHub: a row for each pull request the
 * search finds and each one added by link, and Trash for rows the search no
 * longer finds. Everything it needs from GitHub is read before anything is
 * written, so a failed read leaves every row as it was.
 */
export async function syncGitHubPullRequests(
  options: SyncGitHubPullRequestsOptions,
): Promise<GitHubPullRequestsSyncResult> {
  const now = new Date().toISOString();
  const loaded = await readSource(options.sourceId);
  if (!loaded) {
    throw new ActionContractError(
      "This collection isn't linked to GitHub pull requests.",
      { errorCode: "SOURCE_NOT_FOUND", statusCode: 404 },
    );
  }
  const claimId = await claimSync(options.sourceId, now);
  if (!claimId) return emptyResult("busy");
  const { state, database } = loaded;
  const release = (
    change: (state: GitHubPullRequestsState) => GitHubPullRequestsState,
    columns: Parameters<typeof updateState>[3],
  ) =>
    updateState(
      options.sourceId,
      new Date().toISOString(),
      (current) =>
        current.claim?.id === claimId
          ? { ...change(current), claim: null }
          : null,
      columns,
    );

  const budget = new AbortController();
  const budgetTimer = setTimeout(
    () => budget.abort(),
    Math.max(0, options.budgetMs),
  );
  const endBudget = () => budget.abort();
  if (options.signal?.aborted) endBudget();
  options.signal?.addEventListener("abort", endBudget, { once: true });
  const result = emptyResult("synced");
  try {
    const target = {
      connectionId: state.connectionId,
      signal: budget.signal,
    };
    const stored = await readSourceRows(getDb(), options.sourceId);
    // A pull request added by link is read until its row shows it merged
    // with its checks done, and not again, so a long list of them doesn't
    // cost a read each sync.
    const settled = new Set(
      [...stored]
        .filter(([, row]) =>
          githubPullRequestValuesSettled(parseJsonObject(row.sourceValuesJson)),
        )
        .map(([key]) => key),
    );
    const { searched, searchTotal, added, stillShown } = await readAsLinker(
      state,
      database.orgId,
      async () => {
        const found = state.search
          ? await searchGitHubPullRequests(
              target,
              state.search,
              GITHUB_PULL_REQUESTS_MAX_SEARCH_ROWS,
            )
          : null;
        const foundKeys = new Set(
          (found?.pullRequests ?? []).map(githubPullRequestKey),
        );
        const toRead = state.added
          .filter((key) => !foundKeys.has(key) && !settled.has(key))
          .map(refFromKey)
          .filter((ref): ref is GitHubPullRequestRef => !!ref);
        const added = toRead.length
          ? await readGitHubPullRequests(target, toRead)
          : [];
        // A search leaves out what the linker can no longer see, which
        // isn't a sign the pull request left the search. So a row it
        // stopped finding moves to Trash only if GitHub still shows its pull
        // request; otherwise it stays as it was, as an added one does.
        const complete = !found || found.total <= found.pullRequests.length;
        const leaving = complete
          ? [...stored.keys()]
              .filter(
                (key) => !foundKeys.has(key) && !state.added.includes(key),
              )
              .map(refFromKey)
              .filter((ref): ref is GitHubPullRequestRef => !!ref)
          : [];
        const shown = leaving.length
          ? await readGitHubPullRequests(target, leaving)
          : [];
        return {
          searched: found?.pullRequests ?? [],
          searchTotal: found?.total ?? null,
          added,
          stillShown: new Set(
            shown
              .filter((pr): pr is GitHubPullRequestRecord => !!pr)
              .map(githubPullRequestKey),
          ),
        };
      },
    );
    // A pull request added by link that GitHub no longer shows keeps its
    // row as it was, as a sign-in that lost access leaves rows in place.
    const pullRequests = [
      ...searched,
      ...added.filter((pr): pr is GitHubPullRequestRecord => !!pr),
    ];
    const written = await writeRows({
      loaded,
      pullRequests,
      now,
      claimId,
    });
    result.created = written.created;
    result.updated = written.updated;
    const complete = searchTotal === null || searchTotal <= searched.length;
    const wanted = new Set(pullRequests.map(githubPullRequestKey));
    const latest = (await readSource(options.sourceId))?.state ?? state;
    const keep = new Set([...wanted, ...latest.added]);
    const leaving = [...stillShown].flatMap((key) => {
      const row = written.rows.get(key);
      return row && !keep.has(key) ? [{ key, row }] : [];
    });
    result.trashed = await trashRows(loaded, leaving, now, claimId);
    for (const { key } of leaving) written.rows.delete(key);
    result.rows = written.rows.size;
    result.searchTotal = searchTotal;
    result.problem = !complete ? tooManyResults(searchTotal, now) : null;
    await release(
      (current) => ({
        ...current,
        checkedAt: now,
        syncedAt: new Date().toISOString(),
        rows: result.rows,
        searchTotal,
        problem: result.problem,
      }),
      () => ({
        syncState: "linked",
        freshness: "fresh",
        lastRefreshedAt: now,
        lastSourceUpdatedAt: now,
        lastError: null,
      }),
    );
    return result;
  } catch (error) {
    if (error instanceof GitHubSourceDeadlineError) {
      // One run out of time isn't worth showing; the next one tries again.
      // Runs that keep running out are, so the Sources panel says why the
      // rows stopped catching up.
      const slow: GitHubPullRequestsState["problem"] = {
        code: "unavailable",
        message:
          "GitHub hasn't answered in time for a while. The background sync keeps trying.",
        at: now,
      };
      await release(
        (current) => ({
          ...current,
          checkedAt: now,
          problem:
            Date.parse(now) - Date.parse(current.syncedAt ?? current.linkedAt) >
            SLOW_SYNCS_SHOWN_AFTER_MS
              ? slow
              : current.problem,
        }),
        (next) => ({
          syncState: next.problem ? "error" : "linked",
          freshness: "stale",
          lastRefreshedAt: now,
          ...(next.problem === slow ? { lastError: slow.message } : {}),
        }),
      ).catch(warnLeaseNotReleased);
      return {
        ...result,
        state: "error",
        problem: {
          code: "unavailable",
          message:
            "GitHub didn't answer in time. The background sync tries again.",
          at: now,
        },
      };
    }
    // A contract error, like the link going away mid-sync, is the caller's
    // to see. Anything else is still a failed check: the Sources panel shows
    // it, the rows stay as they were, and the next sync tries again.
    const named = problemFrom(error, now);
    const problem: GitHubPullRequestsState["problem"] =
      named ??
      (error instanceof ActionContractError
        ? null
        : {
            code: "unavailable",
            message:
              "Content couldn't bring the pull requests up to date. It tries again within five minutes, or when the collection is read.",
            at: now,
          });
    if (!named && problem) {
      console.warn(
        "[github-pull-requests] sync failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    await release(
      (current) => ({ ...current, checkedAt: now, problem }),
      () => ({
        syncState: "error",
        freshness: "stale",
        lastRefreshedAt: now,
        lastError: problem?.message ?? "GitHub sync failed.",
      }),
    ).catch(warnLeaseNotReleased);
    if (!problem) throw error;
    if (problem.code === "connection" && options.throwConnectionErrors) {
      throw error;
    }
    if (!named && options.throwUnexpectedErrors) throw error;
    return { ...result, state: "error", problem };
  } finally {
    clearTimeout(budgetTimer);
    options.signal?.removeEventListener("abort", endBudget);
  }
}

/** The repository and number a stored key names. */
function refFromKey(key: string): GitHubPullRequestRef | null {
  const [, owner, repo, number] = /^([^/]+)\/([^#]+)#(\d+)$/.exec(key) ?? [];
  return owner && repo && number
    ? { owner, repo, number: Number(number) }
    : null;
}

/**
 * Creates the link: the source row, a read-only Title mapping, and the
 * GitHub columns. Rows arrive with the first sync.
 */
export async function createGitHubPullRequestsLink(args: {
  database: DatabaseRow;
  search: string | null;
  connectionId: string | null;
  userEmail: string;
  /** Throws if the collection can no longer be linked; runs under its lock. */
  assertLinkable: (tx: Db) => Promise<void>;
}): Promise<string> {
  const { database } = args;
  const sourceId = githubPullRequestsSourceId(database.id);
  const now = new Date().toISOString();
  const state: GitHubPullRequestsState = {
    search: args.search,
    added: [],
    connectionId: args.connectionId,
    linkedBy: args.userEmail,
    linkedOrgId: getRequestOrgId() ?? null,
    linkedAt: now,
    mode: "view_only",
    checkedAt: null,
    syncedAt: null,
    rows: 0,
    searchTotal: null,
    problem: null,
    claim: null,
  };
  await getDb().transaction(async (tx: Db) => {
    await lockContentDatabaseMutation(tx, database.id);
    await args.assertLinkable(tx);
    await tx.insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId,
      databaseId: database.id,
      sourceType: GITHUB_PULL_REQUESTS_SOURCE_TYPE,
      sourceName: githubPullRequestsSourceName(args.search),
      sourceTable: args.search ?? "",
      syncState: "refreshing",
      freshness: "unknown",
      capabilitiesJson: JSON.stringify(githubPullRequestsSourceCapabilities()),
      metadataJson: JSON.stringify(githubPullRequestsMetadataRecord(state)),
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schema.contentDatabaseSourceFields).values({
      id: sourceFieldRowId(sourceId, "title"),
      ownerEmail: database.ownerEmail,
      sourceId,
      propertyId: null,
      localFieldKey: "title",
      sourceFieldKey: "title",
      sourceFieldLabel: "Title",
      sourceFieldType: "string",
      mappingType: "title",
      writeOwner: "source",
      readOnly: 1,
      provenance: "github pull request title",
      freshness: "fresh",
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ensureColumns(tx, {
      database,
      sourceId,
      columns: new Map(),
      removed: new Set(),
      now,
    });
  });
  return sourceId;
}

export interface AddedGitHubPullRequest {
  url: string;
  key: string;
  title: string;
  documentId: string;
  databaseItemId: string;
  /** False when the collection had the row already. */
  created: boolean;
}

function tooManyAddedError() {
  return new ActionContractError(
    `A collection keeps at most ${GITHUB_PULL_REQUESTS_MAX_ADDED} pull requests added by link.`,
    { errorCode: "TOO_MANY_PULL_REQUESTS", statusCode: 409 },
  );
}

/**
 * Adds pull requests to a linked collection by link, so they stay after
 * they leave the search. Each gets its row, made now if it has none; adding
 * one again returns the same row. GitHub is read only for pull requests
 * without a row, as the person who linked the collection, so only they can
 * add: anyone else could show every reader a private pull request only the
 * linker can see.
 */
export async function addGitHubPullRequests(args: {
  databaseId: string;
  refs: GitHubPullRequestRef[];
  /** Who is adding them. */
  actor: string;
}): Promise<AddedGitHubPullRequest[]> {
  const loaded = await readLinkedGitHubPullRequests(args.databaseId);
  if (!loaded) {
    throw new ActionContractError(
      "This collection isn't linked to GitHub pull requests. Make one with create-github-pull-request-collection.",
      { errorCode: "SOURCE_NOT_FOUND", statusCode: 404 },
    );
  }
  if (loaded.state.linkedBy.toLowerCase() !== args.actor.toLowerCase()) {
    throw new ActionContractError(
      "Only the person who linked this collection to GitHub can add pull requests to it, because Content reads them with their GitHub connection.",
      { errorCode: "NOT_THE_LINKER", statusCode: 403 },
    );
  }
  // One entry a pull request, however many times or ways it was named.
  const wanted = [
    ...new Map(
      args.refs.map((ref) => [githubPullRequestKey(ref), ref] as const),
    ),
  ];
  const keys = wanted.map(([key]) => key);
  const newlyAdded = keys.filter((key) => !loaded.state.added.includes(key));
  // Checked here before asking GitHub, and again as the list is saved.
  if (
    loaded.state.added.length + newlyAdded.length >
    GITHUB_PULL_REQUESTS_MAX_ADDED
  ) {
    throw tooManyAddedError();
  }
  const existing = await readSourceRows(getDb(), loaded.source.id);
  const rowPages = wanted.flatMap(([key, ref]) => {
    const row = existing.get(key);
    return row ? [{ key, ref, documentId: row.documentId }] : [];
  });
  const pages = new Map(
    rowPages.length
      ? (
          await getDb()
            .select({
              id: schema.documents.id,
              trashedAt: schema.documents.trashedAt,
            })
            .from(schema.documents)
            .where(
              and(
                inArray(
                  schema.documents.id,
                  rowPages.map((page) => page.documentId),
                ),
                eq(schema.documents.ownerEmail, loaded.database.ownerEmail),
              ),
            )
        ).map((page) => [page.id, page.trashedAt] as const)
      : [],
  );
  // A row whose page someone moved to Trash keeps its record, so adding it
  // would hand back the Trash page. Restoring it is the page's own action,
  // with its own access check.
  const inTrash = rowPages.filter((page) => !!pages.get(page.documentId));
  if (inTrash.length > 0) {
    const names = inTrash.map(
      ({ ref }) => `${ref.owner}/${ref.repo}#${ref.number}`,
    );
    throw new ActionContractError(
      `The row for ${names.join(", ")} is in Trash. Restore it from Trash, then add it again.`,
      { errorCode: "ROW_IN_TRASH", statusCode: 409 },
    );
  }
  // A record whose page was deleted from Trash has no row, so the pull
  // request gets a new one.
  const present = new Set(
    rowPages
      .filter((page) => pages.has(page.documentId))
      .map((page) => page.key),
  );
  const missing = wanted.filter(([key]) => !present.has(key));
  let read: Array<GitHubPullRequestRecord | null> = [];
  if (missing.length > 0) {
    try {
      read = await readAsLinker(loaded.state, loaded.database.orgId, () =>
        readGitHubPullRequests(
          {
            connectionId: loaded.state.connectionId,
            signal: AbortSignal.timeout(ADD_READ_BUDGET_MS),
          },
          missing.map(([, ref]) => ref),
        ),
      );
    } catch (error) {
      if (error instanceof GitHubSourceDeadlineError) {
        throw new ActionContractError(
          "GitHub didn't answer in time. Try again.",
          { errorCode: "GITHUB_UNAVAILABLE", statusCode: 503 },
        );
      }
      const problem = problemFrom(error, new Date().toISOString());
      if (!problem) throw error;
      throw new ActionContractError(problem.message, {
        errorCode:
          problem.code === "connection"
            ? "GITHUB_CONNECTION_REQUIRED"
            : problem.code === "rate_limited"
              ? "GITHUB_RATE_LIMITED"
              : problem.code === "forbidden"
                ? "GITHUB_FORBIDDEN"
                : "GITHUB_UNAVAILABLE",
        statusCode:
          problem.code === "connection"
            ? 401
            : problem.code === "forbidden"
              ? 403
              : problem.code === "rate_limited"
                ? 429
                : 503,
      });
    }
    const unseen = missing.filter((_, index) => !read[index]);
    if (unseen.length > 0) {
      const names = unseen.map(
        ([, ref]) => `${ref.owner}/${ref.repo}#${ref.number}`,
      );
      throw new ActionContractError(
        `GitHub can't find ${names.join(", ")}, or the account that linked this collection can't see ${unseen.length === 1 ? "it" : "them"}.`,
        { errorCode: "PULL_REQUEST_NOT_FOUND", statusCode: 404 },
      );
    }
  }
  const now = new Date().toISOString();
  // Recorded before the rows are written, so a sync that runs in between
  // keeps them, and one that fails here leaves the next sync to make them.
  if (newlyAdded.length > 0) {
    // Set by the update below, which only writes over the list it read, and
    // reads again otherwise. So two adds at once can't both fit under the cap.
    const cap = { reached: false };
    await updateState(loaded.source.id, now, (state) => {
      const added = [...new Set([...state.added, ...newlyAdded])];
      cap.reached = added.length > GITHUB_PULL_REQUESTS_MAX_ADDED;
      return cap.reached ? null : { ...state, added };
    });
    if (cap.reached) throw tooManyAddedError();
  }
  const written = await writeRows({
    loaded,
    pullRequests: read.filter((pr): pr is GitHubPullRequestRecord => !!pr),
    now,
  });
  return wanted.map(([key, ref]) => {
    const row = written.rows.get(key);
    if (!row) {
      throw new ActionContractError(
        "The pull request's row couldn't be saved. Try again.",
        { errorCode: "ROW_NOT_SAVED", statusCode: 409 },
      );
    }
    const values = parseJsonObject(row.sourceValuesJson);
    return {
      url: githubPullRequestWebUrl(ref),
      key,
      title: typeof values.title === "string" ? values.title : "",
      documentId: row.documentId,
      databaseItemId: row.databaseItemId,
      created: !present.has(key),
    };
  });
}

/** One line on what a sync did, for refresh results and agents. */
export function githubPullRequestsSyncSummary(
  result: GitHubPullRequestsSyncResult,
) {
  if (result.state === "busy") {
    return "Another sync is bringing these pull requests up to date.";
  }
  if (result.state === "error") {
    return result.problem?.message ?? "GitHub sync failed.";
  }
  const changes = [
    result.created ? `${result.created} added` : null,
    result.updated ? `${result.updated} updated` : null,
    result.trashed ? `${result.trashed} moved to Trash` : null,
  ].filter(Boolean);
  return `${result.rows} pull request${result.rows === 1 ? "" : "s"}${changes.length ? ` (${changes.join(", ")})` : ", all up to date"}.${result.problem ? ` ${result.problem.message}` : ""}`;
}
