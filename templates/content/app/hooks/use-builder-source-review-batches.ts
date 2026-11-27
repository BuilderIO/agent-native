import { callAction } from "@agent-native/core/client/hooks";
import type {
  PreviewBuilderSourceReviewRequest,
  PreviewBuilderSourceReviewResponse,
} from "@shared/api";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BUILDER_REVIEW_BLOCKS_BATCH_SIZE,
  BUILDER_REVIEW_CONCURRENT_BATCHES,
  BUILDER_REVIEW_CONCURRENT_BLOCKS_BATCHES,
  BUILDER_REVIEW_FIRST_BATCH_SIZE,
  BUILDER_REVIEW_ROW_LIMIT,
  BUILDER_REVIEW_TEXT_BATCH_SIZE,
  builderReviewReplacedRowIds,
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
  loadingTextPageCount: number;
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

function shownBlocksPages(work: ReviewBatchWork) {
  const rows = work.response?.review?.rows ?? [];
  if (rows.length <= BUILDER_REVIEW_ROW_LIMIT) return work.blocksPages;
  const shown = new Set(
    rows.slice(0, BUILDER_REVIEW_ROW_LIMIT).map((row) => row.documentId),
  );
  return work.blocksPages.filter((page) => shown.has(page));
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
  const confirming = shownBlocksPages(work).length;
  if (confirming > 0) return { kind: "confirming", pageCount: confirming };
  return null;
}

function snapshotOf(
  work: ReviewBatchWork,
  error: Error | null,
): ReviewBatchSnapshot {
  const rowCount = reviewRowCount(work);
  const atRowLimit = rowCount >= BUILDER_REVIEW_ROW_LIMIT;
  const textPageCount = atRowLimit
    ? work.loadingTextPageCount
    : work.textPages.length;
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
        loadingTextPageCount: 0,
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
                : { quickStart: true }),
              bodyComparison: "text",
              batchSize: BUILDER_REVIEW_FIRST_BATCH_SIZE,
            });
          }
          if (isAborted()) return;
          work.firstBatchLoaded = true;
          work.firstPages =
            firstPages.length > 0 ? firstPages : (response.documentIds ?? []);
          work.pagesListed = scope !== "all";
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
          const response = await listPages();
          if (isAborted()) return;
          const reviewed = new Set(work.firstPages);
          work.pagesListed = true;
          work.textPages = (response.remainingDocumentIds ?? []).filter(
            (page) => !reviewed.has(page),
          );
          applyTextBatch([], response);
          setSnapshot(snapshotOf(work, null));
        }
        await new Promise<void>((resolve, reject) => {
          const inFlight = new Set<string>();
          const landed: Array<(() => void) | null> = [];
          let applied = 0;
          let running = 0;
          let failure: Error | null = null;
          const fail = (error: unknown) => {
            failure ??=
              error instanceof Error ? error : new Error(String(error));
          };
          work.loadingTextPageCount = 0;
          const textOpen = () =>
            work.textPages.length > 0 &&
            reviewRowCount(work) < BUILDER_REVIEW_ROW_LIMIT;
          const nextBatch = () => {
            if (failure) return null;
            const text = textOpen();
            const [limit, batchSize, queue] = text
              ? [
                  BUILDER_REVIEW_CONCURRENT_BATCHES,
                  BUILDER_REVIEW_TEXT_BATCH_SIZE,
                  work.textPages,
                ]
              : [
                  BUILDER_REVIEW_CONCURRENT_BLOCKS_BATCHES,
                  BUILDER_REVIEW_BLOCKS_BATCH_SIZE,
                  shownBlocksPages(work),
                ];
            if (landed.length - applied >= limit) return null;
            const pages = queue
              .filter((page) => !inFlight.has(page))
              .slice(0, batchSize);
            return pages.length > 0 ? { pages, text } : null;
          };
          const applyLanded = () => {
            const from = applied;
            while (applied < landed.length && landed[applied]) {
              landed[applied]?.();
              applied += 1;
            }
            if (applied > from) setSnapshot(snapshotOf(work, null));
          };
          const pump = () => {
            if (isAborted()) return resolve();
            applyLanded();
            for (let batch = nextBatch(); batch; batch = nextBatch()) {
              start(batch);
            }
            if (running > 0) return;
            if (failure) reject(failure);
            else resolve();
          };
          const start = (batch: { pages: string[]; text: boolean }) => {
            const order = landed.length;
            landed.push(null);
            running += 1;
            for (const page of batch.pages) inFlight.add(page);
            if (batch.text) work.loadingTextPageCount += batch.pages.length;
            void load({
              scope: "selected",
              documentIds: batch.pages,
              bodyComparison: batch.text ? "text" : "blocks",
            })
              .then(
                (response) => () => {
                  if (batch.text) applyTextBatch(batch.pages, response);
                  else applyBlocksBatch(batch.pages, response);
                },
                (error: unknown) => {
                  fail(error);
                  return () => undefined;
                },
              )
              .then((apply) => {
                landed[order] = () => {
                  try {
                    apply();
                  } catch (error) {
                    fail(error);
                  }
                  for (const page of batch.pages) inFlight.delete(page);
                  if (batch.text) {
                    work.loadingTextPageCount -= batch.pages.length;
                  }
                };
                running -= 1;
                pump();
              });
          };
          controller.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
          pump();
        });
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
