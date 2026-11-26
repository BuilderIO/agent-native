import type {
  ContentDatabaseSourceReviewPayload,
  ContentDatabaseSourceReviewRowSummary,
  ContentDatabaseSourceRiskLevel,
} from "@shared/api";

export const BUILDER_REVIEW_FIRST_BATCH_SIZE = 5;
export const BUILDER_REVIEW_TEXT_BATCH_SIZE = 20;
export const BUILDER_REVIEW_BLOCKS_BATCH_SIZE = 5;
export const BUILDER_REVIEW_CONCURRENT_BATCHES = 3;
export const BUILDER_REVIEW_CONCURRENT_BLOCKS_BATCHES = 1;
export const BUILDER_REVIEW_ROW_LIMIT = 100;
export const BUILDER_REVIEW_CHECK_BATCH_SIZE = 3;

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

export function mergeBuilderReviewBatch(
  current: ContentDatabaseSourceReviewPayload | null,
  batch: ContentDatabaseSourceReviewPayload | null,
  replacedDocumentIds: readonly string[] = [],
  rowLimit: number | null = BUILDER_REVIEW_ROW_LIMIT,
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
  const limitedRows = rowLimit === null ? rows : rows.slice(0, rowLimit);
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

export function chunkBuilderReviewIds<T>(ids: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}
