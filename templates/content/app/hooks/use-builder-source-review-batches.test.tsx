// @vitest-environment happy-dom

import type {
  ContentDatabaseSourceReviewPayload,
  ContentDatabaseSourceReviewRowSummary,
  PreviewBuilderSourceReviewRequest,
  PreviewBuilderSourceReviewResponse,
} from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal()),
  callAction,
}));

import {
  type BuilderSourceReviewBatches,
  useBuilderSourceReviewBatches,
} from "./use-builder-source-review-batches";

type Request = PreviewBuilderSourceReviewRequest & { documentId: string };

function row(changeSetId: string, documentId: string | undefined) {
  return {
    changeSetId,
    databaseItemId: `item-${documentId}`,
    documentId,
    title: changeSetId,
    targetEntryId: null,
    fieldChanges: [],
    bodyChange: null,
    riskLevel: "low",
    riskReasons: [],
    conflictState: "none",
    effect: "update_entry",
    execution: null,
  } as unknown as ContentDatabaseSourceReviewRowSummary;
}

function review(
  rows: ContentDatabaseSourceReviewRowSummary[],
): ContentDatabaseSourceReviewPayload | null {
  if (rows.length === 0) return null;
  return {
    summary: "",
    sourceName: "Builder",
    sourceTable: "article",
    totalRowCount: rows.length,
    preparedRowLimit: rows.length,
    pushMode: "autosave",
    dryRunOnly: true,
    liveWritesEnabled: false,
    riskLevel: "low",
    riskReasons: [],
    rows,
    result: { status: "write_disabled", message: "Writes are off." },
  };
}

function response(
  rows: ContentDatabaseSourceReviewRowSummary[],
  extra: Partial<PreviewBuilderSourceReviewResponse> = {},
): PreviewBuilderSourceReviewResponse {
  return {
    sourceId: "source-1",
    sourceTable: "article",
    changeSetIds: rows.map((entry) => entry.changeSetId),
    review: review(rows),
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const pages = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, index) => `doc-${from + index}`);

let container: HTMLDivElement;
let root: Root;
let latest: BuilderSourceReviewBatches;

function Probe(props: Parameters<typeof useBuilderSourceReviewBatches>[0]) {
  latest = useBuilderSourceReviewBatches(props);
  return null;
}

async function settle() {
  for (let round = 0; round < 40; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function requests(): Request[] {
  return callAction.mock.calls.map(([, params]) => params as Request);
}

beforeEach(() => {
  callAction.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe("useBuilderSourceReviewBatches", () => {
  it("loads a whole source's changed pages while it finds the rest", async () => {
    const listing = deferred<PreviewBuilderSourceReviewResponse>();
    callAction.mockImplementation(async (_name: string, params: Request) => {
      if (params.batchSize === 0) return listing.promise;
      const ids = params.documentIds ?? [];
      if (params.bodyComparison === "blocks") {
        return response([row("c3-blocks", "doc-3")]);
      }
      if (ids.includes("doc-1")) {
        return response([row("c1", "doc-1"), row("c2", "doc-2")]);
      }
      return response([row("c3", "doc-3")], {
        blocksCheckDocumentIds: ["doc-3"],
      });
    });

    act(() =>
      root.render(
        <Probe
          documentId="page-1"
          sourceId="source-1"
          scope="all"
          priorityDocumentIds={["doc-2", "doc-1", "doc-2"]}
          enabled
        />,
      ),
    );
    await settle();

    expect(requests()).toEqual([
      expect.objectContaining({ scope: "all", batchSize: 0 }),
      expect.objectContaining({
        scope: "selected",
        documentIds: ["doc-2", "doc-1"],
        bodyComparison: "text",
      }),
    ]);
    expect(latest.loadingFirstBatch).toBe(false);
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c1", "c2"],
    );
    expect(latest.progress).toEqual({ kind: "listing", pageCount: 0 });

    listing.resolve(
      response([], {
        documentIds: [],
        remainingDocumentIds: ["doc-1", "doc-2", "doc-3", "doc-4"],
      }),
    );
    await settle();

    expect(requests().slice(2)).toEqual([
      expect.objectContaining({
        scope: "selected",
        documentIds: ["doc-3", "doc-4"],
        bodyComparison: "text",
      }),
      expect.objectContaining({
        scope: "selected",
        documentIds: ["doc-3"],
        bodyComparison: "blocks",
      }),
    ]);
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c1", "c2", "c3-blocks"],
    );
    expect(latest.selectionChangeSetIdMap).toEqual({ c3: "c3-blocks" });
    expect(latest.progress).toBeNull();
    expect(latest.error).toBeNull();
  });

  it("loads a few batches at once, keeps rows when one fails, and Retry finishes", async () => {
    let inFlight = 0;
    let mostInFlight = 0;
    let failNext = true;
    const selected = pages(0, 65);
    callAction.mockImplementation(async (_name: string, params: Request) => {
      const ids = params.documentIds ?? [];
      if (params.batchSize) {
        return response([row(`c-${ids[0]}`, ids[0])], {
          documentIds: ids.slice(0, params.batchSize),
          remainingDocumentIds: ids.slice(params.batchSize),
        });
      }
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (ids[0] === "doc-24" && failNext) {
        failNext = false;
        throw new Error("Batch failed");
      }
      return response([row(`c-${ids[0]}`, ids[0])]);
    });

    act(() =>
      root.render(
        <Probe
          documentId="page-1"
          sourceId="source-1"
          scope="selected"
          documentIds={selected}
          priorityDocumentIds={["doc-40"]}
          enabled
        />,
      ),
    );
    await settle();

    expect(requests()[0]).toMatchObject({
      scope: "selected",
      batchSize: 5,
      documentIds: ["doc-40", ...selected.filter((id) => id !== "doc-40")],
    });
    expect(mostInFlight).toBe(3);
    expect(latest.error?.message).toBe("Batch failed");
    expect(latest.progress).toBeNull();
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c-doc-40", "c-doc-4", "c-doc-45"],
    );

    act(() => latest.retry());
    await settle();

    expect(latest.error).toBeNull();
    expect(latest.progress).toBeNull();
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c-doc-40", "c-doc-4", "c-doc-45", "c-doc-24"],
    );
  });

  it("keeps rows past the row limit so they show when confirmed rows leave", async () => {
    const blocksGate = deferred<void>();
    const needsBlocks = new Set(pages(10, 40));
    callAction.mockImplementation(async (_name: string, params: Request) => {
      const ids = params.documentIds ?? [];
      if (params.bodyComparison === "blocks") {
        await blocksGate.promise;
        return response([]);
      }
      const reviewed = params.batchSize ? ids.slice(0, params.batchSize) : ids;
      const blocksCheckDocumentIds = reviewed.filter((id) =>
        needsBlocks.has(id),
      );
      return response(
        reviewed.map((id) => row(`c-${id}`, id)),
        {
          ...(params.batchSize
            ? { remainingDocumentIds: ids.slice(params.batchSize) }
            : {}),
          ...(blocksCheckDocumentIds.length > 0
            ? { blocksCheckDocumentIds }
            : {}),
        },
      );
    });

    act(() =>
      root.render(
        <Probe
          documentId="page-1"
          sourceId="source-1"
          scope="selected"
          documentIds={pages(0, 130)}
          enabled
        />,
      ),
    );
    await settle();

    expect(latest.data?.review?.rows).toHaveLength(100);
    expect(latest.data?.review?.totalRowCount).toBe(125);
    expect(latest.moreRowsBeyondLimit).toBe(true);
    expect(latest.progress).toEqual({ kind: "confirming", pageCount: 30 });

    blocksGate.resolve();
    await settle();

    const rowIds = latest.data?.review?.rows.map((entry) => entry.changeSetId);
    expect(rowIds).toHaveLength(100);
    expect(rowIds).toContain("c-doc-124");
    expect(rowIds?.slice(-1)).toEqual(["c-doc-129"]);
    expect(latest.unchangedRowCount).toBe(30);
    expect(latest.moreRowsBeyondLimit).toBe(false);
    expect(latest.progress).toBeNull();
  });
});
