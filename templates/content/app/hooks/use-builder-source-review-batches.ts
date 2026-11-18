import { callAction } from "@agent-native/core/client/hooks";
import type {
  PreviewBuilderSourceReviewRequest,
  PreviewBuilderSourceReviewResponse,
} from "@shared/api";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BUILDER_REVIEW_BLOCKS_BATCH_SIZE,
  BUILDER_REVIEW_FIRST_BATCH_SIZE,
  BUILDER_REVIEW_ROW_LIMIT,
  BUILDER_REVIEW_TEXT_BATCH_SIZE,
  builderReviewReplacedRowIds,
  composeBuilderReviewIdRemap,
  mergeBuilderReviewBatch,
  prioritizedBuilderReviewDocumentIds,
} from "@/components/editor/database-sources/builder-review-batches";

export type BuilderSourceReviewBatchesProgress = {
  /** Pages still to load as text, or text changes still to check as blocks. */
  kind: "loading" | "confirming";
  pageCount: number;
};

export type BuilderSourceReviewBatches = {
  data: PreviewBuilderSourceReviewResponse | null;
  /** The first batch hasn't come back yet. */
  loadingFirstBatch: boolean;
  progress: BuilderSourceReviewBatchesProgress | null;
  /** The batch that failed; Retry loads it again. */
  error: Error | null;
  /** Rows a blocks check found unchanged, so the review dropped them. */
  unchangedRowCount: number;
  /** Pages left unreviewed once the review reached its row limit. */
  moreRowsBeyondLimit: boolean;
  /** Earlier change set ids of rows a later batch gave a new id. */
  selectionChangeSetIdMap: Record<string, string> | null;
  retry: () => void;
};

type ReviewBatchWork = {
  key: string;
  firstBatchLoaded: boolean;
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

function snapshotOf(
  work: ReviewBatchWork,
  error: Error | null,
): ReviewBatchSnapshot {
  const atRowLimit = reviewRowCount(work) >= BUILDER_REVIEW_ROW_LIMIT;
  const textPageCount = atRowLimit ? 0 : work.textPages.length;
  return {
    key: work.key,
    data: work.response,
    loadingFirstBatch: !work.firstBatchLoaded,
    progress:
      textPageCount > 0
        ? { kind: "loading", pageCount: textPageCount }
        : work.blocksPages.length > 0
          ? { kind: "confirming", pageCount: work.blocksPages.length }
          : null,
    error,
    unchangedRowCount: work.unchangedRowCount,
    moreRowsBeyondLimit: atRowLimit && work.textPages.length > 0,
    selectionChangeSetIdMap:
      Object.keys(work.idRemap).length > 0 ? work.idRemap : null,
  };
}

/**
 * Loads a Builder review in batches, so its first rows show in about a
 * second however many pages it covers. Pages are compared as text first,
 * which is fast; pages whose text changed are then checked as Builder
 * blocks, the way Check compares them, which corrects or drops their rows.
 */
export function useBuilderSourceReviewBatches(args: {
  documentId: string;
  sourceId: string | null;
  scope: "selected" | "all";
  documentIds?: string[];
  /** Selected pages to load first: those with a recorded change. */
  priorityDocumentIds?: string[];
  enabled: boolean;
}): BuilderSourceReviewBatches {
  const { documentId, sourceId, scope, enabled } = args;
  // Read when a review starts, so a change landing mid-review doesn't
  // restart it.
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
  // Closing the review forgets its rows, so a reopen loads them fresh.
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

    void (async () => {
      try {
        while (!controller.signal.aborted) {
          if (!work.firstBatchLoaded) {
            const response = await load({
              scope,
              documentIds: selectedDocumentIds,
              bodyComparison: "text",
              batchSize: BUILDER_REVIEW_FIRST_BATCH_SIZE,
            });
            if (controller.signal.aborted) return;
            work.firstBatchLoaded = true;
            work.response = mergedResponse(null, response, []);
            work.textPages = response.remainingDocumentIds ?? [];
            work.blocksPages = response.blocksCheckDocumentIds ?? [];
          } else if (
            work.textPages.length > 0 &&
            reviewRowCount(work) < BUILDER_REVIEW_ROW_LIMIT
          ) {
            const pages = work.textPages.slice(
              0,
              BUILDER_REVIEW_TEXT_BATCH_SIZE,
            );
            const response = await load({
              scope: "selected",
              documentIds: pages,
              bodyComparison: "text",
            });
            if (controller.signal.aborted) return;
            work.textPages = work.textPages.slice(pages.length);
            work.blocksPages = [
              ...work.blocksPages,
              ...(response.blocksCheckDocumentIds ?? []),
            ];
            work.response = mergedResponse(work.response, response, []);
          } else if (work.blocksPages.length > 0) {
            const pages = work.blocksPages.slice(
              0,
              BUILDER_REVIEW_BLOCKS_BATCH_SIZE,
            );
            const response = await load({
              scope: "selected",
              documentIds: pages,
              bodyComparison: "blocks",
            });
            if (controller.signal.aborted) return;
            const previousRows = work.response?.review?.rows ?? [];
            work.blocksPages = work.blocksPages.slice(pages.length);
            work.response = mergedResponse(work.response, response, pages);
            const nextRows = work.response?.review?.rows ?? [];
            work.idRemap = composeBuilderReviewIdRemap(
              work.idRemap,
              builderReviewReplacedRowIds(previousRows, nextRows, pages),
            );
            const nextDocumentIds = new Set(
              nextRows.map((row) => row.documentId),
            );
            work.unchangedRowCount += new Set(
              previousRows
                .filter(
                  (row) =>
                    row.documentId &&
                    pages.includes(row.documentId) &&
                    !nextDocumentIds.has(row.documentId),
                )
                .map((row) => row.documentId),
            ).size;
          } else {
            return;
          }
          setSnapshot(snapshotOf(work, null));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
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
    setSnapshot((current) => ({ ...current, error: null }));
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
  );
  return {
    ...(current ?? batch),
    changeSetIds: review?.rows.map((row) => row.changeSetId) ?? [],
    review,
  };
}
