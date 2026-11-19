import { callAction } from "@agent-native/core/client/hooks";
import type {
  PreviewBuilderSourceReviewRequest,
  PreviewBuilderSourceReviewResponse,
} from "@shared/api";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BUILDER_REVIEW_BLOCKS_BATCH_SIZE,
  BUILDER_REVIEW_CONCURRENT_BATCHES,
  BUILDER_REVIEW_FIRST_BATCH_SIZE,
  BUILDER_REVIEW_ROW_LIMIT,
  BUILDER_REVIEW_TEXT_BATCH_SIZE,
  builderReviewReplacedRowIds,
  chunkBuilderReviewIds,
  composeBuilderReviewIdRemap,
  mergeBuilderReviewBatch,
  prioritizedBuilderReviewDocumentIds,
} from "@/components/editor/database-sources/builder-review-batches";

export type BuilderSourceReviewBatchesProgress = {
  kind: "listing" | "loading" | "confirming";
  pageCount: number;
};

export type BuilderSourceReviewBatches = {
  data: PreviewBuilderSourceReviewResponse | null;
  loadingFirstBatch: boolean;
  progress: BuilderSourceReviewBatchesProgress | null;
  error: Error | null;
  unchangedRowCount: number;
  moreRowsBeyondLimit: boolean;
  selectionChangeSetIdMap: Record<string, string> | null;
  retry: () => void;
};

type ReviewBatchWork = {
  key: string;
  firstBatchLoaded: boolean;
  pagesListed: boolean;
  firstPages: string[];
  textPages: string[];
  blocksPages: string[];
  response: PreviewBuilderSourceReviewResponse | null;
  idRemap: Record<string, string>;
  unchangedRowCount: number;
};

type ReviewBatchSnapshot = Omit<BuilderSourceReviewBatches, "retry"> & {
  key: string | null;
};

const IDLE_SNAPSHOT: ReviewBatchSnapshot = {
  key: null,
  data: null,
  loadingFirstBatch: false,
  progress: null,
  error: null,
  unchangedRowCount: 0,
  moreRowsBeyondLimit: false,
  selectionChangeSetIdMap: null,
};

function reviewRowCount(work: ReviewBatchWork) {
  return work.response?.review?.rows.length ?? 0;
}

function limitedResponse(
  response: PreviewBuilderSourceReviewResponse | null,
): PreviewBuilderSourceReviewResponse | null {
  if (!response?.review) return response;
  if (response.review.rows.length <= BUILDER_REVIEW_ROW_LIMIT) return response;
  const rows = response.review.rows.slice(0, BUILDER_REVIEW_ROW_LIMIT);
  return {
    ...response,
    changeSetIds: rows.map((row) => row.changeSetId),
    review: { ...response.review, preparedRowLimit: rows.length, rows },
  };
}

function progressOf(
  work: ReviewBatchWork,
  textPageCount: number,
): BuilderSourceReviewBatchesProgress | null {
  if (!work.firstBatchLoaded) return null;
  if (!work.pagesListed) return { kind: "listing", pageCount: 0 };
  if (textPageCount > 0) return { kind: "loading", pageCount: textPageCount };
  if (work.blocksPages.length > 0) {
    return { kind: "confirming", pageCount: work.blocksPages.length };
  }
  return null;
}

function snapshotOf(
  work: ReviewBatchWork,
  error: Error | null,
): ReviewBatchSnapshot {
  const rowCount = reviewRowCount(work);
  const atRowLimit = rowCount >= BUILDER_REVIEW_ROW_LIMIT;
  const textPageCount = atRowLimit ? 0 : work.textPages.length;
  return {
    key: work.key,
    data: limitedResponse(work.response),
    loadingFirstBatch: !work.firstBatchLoaded,
    progress: error ? null : progressOf(work, textPageCount),
    error,
    unchangedRowCount: work.unchangedRowCount,
    moreRowsBeyondLimit:
      rowCount > BUILDER_REVIEW_ROW_LIMIT ||
      (atRowLimit && work.textPages.length > 0),
    selectionChangeSetIdMap:
      Object.keys(work.idRemap).length > 0 ? work.idRemap : null,
  };
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

export function useBuilderSourceReviewBatches(args: {
  documentId: string;
  sourceId: string | null;
  scope: "selected" | "all";
  documentIds?: string[];
  priorityDocumentIds?: string[];
  enabled: boolean;
}): BuilderSourceReviewBatches {
  const { documentId, sourceId, scope, enabled } = args;
  const priorityDocumentIdsRef = useRef(args.priorityDocumentIds ?? []);
  useEffect(() => {
    priorityDocumentIdsRef.current = args.priorityDocumentIds ?? [];
  });
  const documentIdsKey =
    scope === "selected" ? (args.documentIds ?? []).join("\u0000") : "";
  const key =
    enabled && sourceId
      ? [documentId, sourceId, scope, documentIdsKey].join("\u0001")
      : null;
  const [snapshot, setSnapshot] = useState(IDLE_SNAPSHOT);
  const [retryToken, setRetryToken] = useState(0);
  const workRef = useRef<ReviewBatchWork | null>(null);
  const [snapshotKey, setSnapshotKey] = useState(key);
  if (snapshotKey !== key) {
    setSnapshotKey(key);
    setSnapshot(IDLE_SNAPSHOT);
  }

  useEffect(() => {
    if (!key || !sourceId) {
      workRef.current = null;
      return;
    }
    if (workRef.current?.key !== key) {
      workRef.current = {
        key,
        firstBatchLoaded: false,
        pagesListed: false,
        firstPages: [],
        textPages: [],
        blocksPages: [],
        response: null,
        idRemap: {},
        unchangedRowCount: 0,
      };
    }
    const work = workRef.current;
    const selectedDocumentIds = documentIdsKey
      ? prioritizedBuilderReviewDocumentIds(
          documentIdsKey.split("\u0000"),
          priorityDocumentIdsRef.current,
        )
      : undefined;
    const controller = new AbortController();
    const isAborted = () => controller.signal.aborted;
    const load = async (request: PreviewBuilderSourceReviewRequest) =>
      callAction<PreviewBuilderSourceReviewResponse>(
        "preview-builder-source-review",
        { documentId, sourceId, ...request },
        {
          method: "GET",
          signal: controller.signal,
          headers: { "X-Agent-Native-Interactive": "1" },
        },
      );
    const listPages = () =>
      load({ scope: "all", bodyComparison: "text", batchSize: 0 });

    const applyTextBatch = (
      pages: string[],
      response: PreviewBuilderSourceReviewResponse,
    ) => {
      const done = new Set(pages);
      work.textPages = work.textPages.filter((page) => !done.has(page));
      work.blocksPages = uniqueIds([
        ...work.blocksPages,
        ...(response.blocksCheckDocumentIds ?? []),
      ]);
      work.response = mergedResponse(work.response, response, []);
    };
    const applyBlocksBatch = (
      pages: string[],
      response: PreviewBuilderSourceReviewResponse,
    ) => {
      const done = new Set(pages);
      const previousRows = work.response?.review?.rows ?? [];
      work.blocksPages = work.blocksPages.filter((page) => !done.has(page));
      work.response = mergedResponse(work.response, response, pages);
      const nextRows = work.response.review?.rows ?? [];
      work.idRemap = composeBuilderReviewIdRemap(
        work.idRemap,
        builderReviewReplacedRowIds(previousRows, nextRows, pages),
      );
      const nextDocumentIds = new Set(nextRows.map((row) => row.documentId));
      work.unchangedRowCount += new Set(
        previousRows
          .filter(
            (row) =>
              row.documentId &&
              done.has(row.documentId) &&
              !nextDocumentIds.has(row.documentId),
          )
          .map((row) => row.documentId),
      ).size;
    };

    void (async () => {
      try {
        let listing: Promise<PreviewBuilderSourceReviewResponse> | null = null;
        if (!work.firstBatchLoaded) {
          const firstPages =
            scope === "all"
              ? uniqueIds(priorityDocumentIdsRef.current).slice(
                  0,
                  BUILDER_REVIEW_FIRST_BATCH_SIZE,
                )
              : [];
          let response: PreviewBuilderSourceReviewResponse;
          if (firstPages.length > 0) {
            listing = listPages();
            void listing.catch(() => undefined);
            response = await load({
              scope: "selected",
              documentIds: firstPages,
              bodyComparison: "text",
            });
          } else {
            response = await load({
              scope,
              ...(selectedDocumentIds
                ? {
                    documentIds: selectedDocumentIds.slice(
                      0,
                      BUILDER_REVIEW_FIRST_BATCH_SIZE,
                    ),
                  }
                : {}),
              bodyComparison: "text",
              batchSize: BUILDER_REVIEW_FIRST_BATCH_SIZE,
            });
          }
          if (isAborted()) return;
          work.firstBatchLoaded = true;
          work.firstPages = firstPages;
          work.pagesListed = firstPages.length === 0;
          work.response = mergedResponse(null, response, []);
          work.textPages = [
            ...(response.remainingDocumentIds ?? []),
            ...(selectedDocumentIds?.slice(BUILDER_REVIEW_FIRST_BATCH_SIZE) ??
              []),
          ];
          work.blocksPages = response.blocksCheckDocumentIds ?? [];
          setSnapshot(snapshotOf(work, null));
        }
        if (!work.pagesListed) {
          const response = await (listing ?? listPages());
          if (isAborted()) return;
          const reviewed = new Set(work.firstPages);
          work.pagesListed = true;
          work.textPages = (response.remainingDocumentIds ?? []).filter(
            (page) => !reviewed.has(page),
          );
          applyTextBatch([], response);
          setSnapshot(snapshotOf(work, null));
        }
        while (!isAborted()) {
          const textPhase =
            work.textPages.length > 0 &&
            reviewRowCount(work) < BUILDER_REVIEW_ROW_LIMIT;
          if (!textPhase && work.blocksPages.length === 0) return;
          const batchSize = textPhase
            ? BUILDER_REVIEW_TEXT_BATCH_SIZE
            : BUILDER_REVIEW_BLOCKS_BATCH_SIZE;
          const batches = chunkBuilderReviewIds(
            (textPhase ? work.textPages : work.blocksPages).slice(
              0,
              batchSize * BUILDER_REVIEW_CONCURRENT_BATCHES,
            ),
            batchSize,
          );
          const results = await Promise.allSettled(
            batches.map(async (pages) => ({
              pages,
              response: await load({
                scope: "selected",
                documentIds: pages,
                bodyComparison: textPhase ? "text" : "blocks",
              }),
            })),
          );
          if (isAborted()) return;
          let failure: Error | null = null;
          for (const result of results) {
            if (result.status === "rejected") {
              failure ??=
                result.reason instanceof Error
                  ? result.reason
                  : new Error(String(result.reason));
            } else if (textPhase) {
              applyTextBatch(result.value.pages, result.value.response);
            } else {
              applyBlocksBatch(result.value.pages, result.value.response);
            }
          }
          if (failure) throw failure;
          setSnapshot(snapshotOf(work, null));
        }
      } catch (error) {
        if (isAborted()) return;
        setSnapshot(
          snapshotOf(
            work,
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
      }
    })();
    return () => controller.abort();
  }, [documentId, documentIdsKey, key, retryToken, scope, sourceId]);

  const retry = useCallback(() => {
    const work = workRef.current;
    setSnapshot((current) =>
      work && work.key === current.key
        ? snapshotOf(work, null)
        : { ...current, error: null },
    );
    setRetryToken((token) => token + 1);
  }, []);
  const current = snapshot.key === key ? snapshot : IDLE_SNAPSHOT;
  return {
    data: current.data,
    loadingFirstBatch: key
      ? current.key !== key || current.loadingFirstBatch
      : false,
    progress: current.progress,
    error: current.error,
    unchangedRowCount: current.unchangedRowCount,
    moreRowsBeyondLimit: current.moreRowsBeyondLimit,
    selectionChangeSetIdMap: current.selectionChangeSetIdMap,
    retry,
  };
}

function mergedResponse(
  current: PreviewBuilderSourceReviewResponse | null,
  batch: PreviewBuilderSourceReviewResponse,
  replacedDocumentIds: string[],
): PreviewBuilderSourceReviewResponse {
  const review = mergeBuilderReviewBatch(
    current?.review ?? null,
    batch.review,
    replacedDocumentIds,
    null,
  );
  return {
    ...(current ?? batch),
    changeSetIds: review?.rows.map((row) => row.changeSetId) ?? [],
    review,
  };
}
