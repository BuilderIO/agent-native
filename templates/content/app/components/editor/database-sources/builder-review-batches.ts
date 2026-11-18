import type {
  ContentDatabaseSourceReviewPayload,
  ContentDatabaseSourceReviewRowSummary,
  ContentDatabaseSourceRiskLevel,
} from "@shared/api";

/** Pages in a review's first batch, kept small so its rows show quickly. */
export const BUILDER_REVIEW_FIRST_BATCH_SIZE = 5;
/** Pages in each later batch compared as text. */
export const BUILDER_REVIEW_TEXT_BATCH_SIZE = 20;
/** Pages in each batch that checks text changes against Builder blocks. */
export const BUILDER_REVIEW_BLOCKS_BATCH_SIZE = 10;
/** Batches a review loads at once after its first. */
export const BUILDER_REVIEW_CONCURRENT_BATCHES = 3;
/** Rows one review shows and Check prepares, as the server caps them. */
export const BUILDER_REVIEW_ROW_LIMIT = 100;
/** Rows Check prepares per request, so each one stays short. */
export const BUILDER_REVIEW_CHECK_BATCH_SIZE = 10;

// A merged review takes the most pressing status of the batches it merges;
// "succeeded" only when every batch succeeded.
const RESULT_STATUS_ORDER: Array<
  ContentDatabaseSourceReviewPayload["result"]["status"]
> = [
  "blocked",
  "reconciliation_required",
  "failed",
  "running",
  "stale",
  "validated",
  "write_disabled",
  "succeeded",
];

function riskRank(risk: ContentDatabaseSourceRiskLevel) {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

function mergedResult(
  results: Array<ContentDatabaseSourceReviewPayload["result"]>,
) {
  return results.reduce((best, result) =>
    RESULT_STATUS_ORDER.indexOf(result.status) <
    RESULT_STATUS_ORDER.indexOf(best.status)
      ? result
      : best,
  );
}

/**
 * Adds a batch's review to the rows loaded so far. Rows for
 * `replacedDocumentIds` give way to the batch's rows for those pages, in
 * place, so a later pass can correct a row or drop it.
 */
export function mergeBuilderReviewBatch(
  current: ContentDatabaseSourceReviewPayload | null,
  batch: ContentDatabaseSourceReviewPayload | null,
  replacedDocumentIds: readonly string[] = [],
): ContentDatabaseSourceReviewPayload | null {
  const base = current ?? batch;
  if (!base) return null;
  const replaced = new Set(replacedDocumentIds);
  const batchRows = batch?.rows ?? [];
  const batchRowsByDocumentId = new Map<
    string,
    ContentDatabaseSourceReviewRowSummary[]
  >();
  for (const row of batchRows) {
    if (!row.documentId || !replaced.has(row.documentId)) continue;
    const rows = batchRowsByDocumentId.get(row.documentId) ?? [];
    rows.push(row);
    batchRowsByDocumentId.set(row.documentId, rows);
  }

  const rows: ContentDatabaseSourceReviewRowSummary[] = [];
  const seen = new Set<string>();
  const push = (row: ContentDatabaseSourceReviewRowSummary) => {
    if (seen.has(row.changeSetId)) return;
    seen.add(row.changeSetId);
    rows.push(row);
  };
  for (const row of current?.rows ?? []) {
    if (!row.documentId || !replaced.has(row.documentId)) {
      push(row);
      continue;
    }
    for (const replacement of batchRowsByDocumentId.get(row.documentId) ?? []) {
      push(replacement);
    }
    batchRowsByDocumentId.delete(row.documentId);
  }
  for (const row of batchRows) push(row);
  if (rows.length === 0) return null;

  let riskLevel: ContentDatabaseSourceRiskLevel = "low";
  const riskReasons = new Set<string>();
  for (const row of rows) {
    if (riskRank(row.riskLevel) > riskRank(riskLevel)) {
      riskLevel = row.riskLevel;
    }
    for (const reason of row.riskReasons) riskReasons.add(reason);
    if (row.conflictState === "source_changed") {
      if (riskRank("medium") > riskRank(riskLevel)) riskLevel = "medium";
      riskReasons.add("source changed");
    }
  }
  const limitedRows = rows.slice(0, BUILDER_REVIEW_ROW_LIMIT);
  return {
    ...base,
    summary:
      rows.length === 1
        ? "1 Builder row has changes ready to review."
        : `${rows.length} Builder rows have changes ready to review.`,
    totalRowCount: rows.length,
    preparedRowLimit: limitedRows.length,
    riskLevel,
    riskReasons: [...riskReasons],
    rows: limitedRows,
    result: mergedResult(
      [current?.result, batch?.result].filter(
        (result): result is ContentDatabaseSourceReviewPayload["result"] =>
          !!result,
      ),
    ),
  };
}

/**
 * The new change set id of each replaced page whose row came back under
 * another id, so a selection made before the replacement carries over.
 */
export function builderReviewReplacedRowIds(
  previousRows: readonly ContentDatabaseSourceReviewRowSummary[],
  nextRows: readonly ContentDatabaseSourceReviewRowSummary[],
  replacedDocumentIds: readonly string[],
): Record<string, string> {
  const replaced = new Set(replacedDocumentIds);
  const nextIdByDocumentId = new Map<string, string>();
  for (const row of nextRows) {
    if (row.documentId && replaced.has(row.documentId)) {
      nextIdByDocumentId.set(row.documentId, row.changeSetId);
    }
  }
  const remap: Record<string, string> = {};
  for (const row of previousRows) {
    if (!row.documentId || !replaced.has(row.documentId)) continue;
    const nextId = nextIdByDocumentId.get(row.documentId);
    if (nextId && nextId !== row.changeSetId) remap[row.changeSetId] = nextId;
  }
  return remap;
}

/** Adds `next` to a cumulative id remap, following earlier ids through. */
export function composeBuilderReviewIdRemap(
  current: Record<string, string>,
  next: Record<string, string>,
): Record<string, string> {
  const composed: Record<string, string> = {};
  for (const [from, to] of Object.entries(current)) {
    composed[from] = next[to] ?? to;
  }
  for (const [from, to] of Object.entries(next)) composed[from] = to;
  return composed;
}

/**
 * Puts pages with a recorded change first, keeping each group's order, so a
 * review's first batch holds rows to tick rather than unchanged pages.
 */
export function prioritizedBuilderReviewDocumentIds(
  documentIds: readonly string[],
  priorityDocumentIds: readonly string[],
): string[] {
  const priority = new Set(priorityDocumentIds);
  return [
    ...documentIds.filter((documentId) => priority.has(documentId)),
    ...documentIds.filter((documentId) => !priority.has(documentId)),
  ];
}

/** Splits ids into consecutive chunks of at most `size`. */
export function chunkBuilderReviewIds<T>(ids: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}
