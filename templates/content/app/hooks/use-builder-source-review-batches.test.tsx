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

import { BUILDER_REVIEW_ROW_LIMIT } from "@/components/editor/database-sources/builder-review-batches";

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
  it("loads a whole source's changed pages before it finds the rest", async () => {
    const listing = deferred<PreviewBuilderSourceReviewResponse>();
    const firstBatch = deferred<PreviewBuilderSourceReviewResponse>();
    callAction.mockImplementation(async (_name: string, params: Request) => {
      if (params.batchSize === 0) return listing.promise;
      const ids = params.documentIds ?? [];
      if (params.bodyComparison === "blocks") {
        return response([row("c3-blocks", "doc-3")]);
      }
      if (ids.includes("doc-1")) return firstBatch.promise;
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
      expect.objectContaining({
        scope: "selected",
        documentIds: ["doc-2", "doc-1"],
        bodyComparison: "text",
      }),
    ]);
    expect(latest.loadingFirstBatch).toBe(true);

    firstBatch.resolve(response([row("c1", "doc-1"), row("c2", "doc-2")]));
    await settle();

    expect(requests().slice(1)).toEqual([
      expect.objectContaining({ scope: "all", batchSize: 0 }),
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

  it("quick-starts a whole source with no changed pages known, then lists the rest", async () => {
    const quickStart = deferred<PreviewBuilderSourceReviewResponse>();
    const listing = deferred<PreviewBuilderSourceReviewResponse>();
    callAction.mockImplementation(async (_name: string, params: Request) => {
      if (params.quickStart) return quickStart.promise;
      if (params.batchSize === 0) return listing.promise;
      const ids = params.documentIds ?? [];
      return response(ids.map((id) => row(`c-${id}`, id)));
    });

    act(() =>
      root.render(
        <Probe documentId="page-1" sourceId="source-1" scope="all" enabled />,
      ),
    );
    await settle();

    expect(requests()).toEqual([
      expect.objectContaining({
        scope: "all",
        quickStart: true,
        bodyComparison: "text",
        batchSize: 5,
      }),
    ]);

    quickStart.resolve(
      response([row("c-doc-1", "doc-1"), row("c-doc-2", "doc-2")], {
        documentIds: ["doc-1", "doc-2"],
      }),
    );
    await settle();

    expect(requests().slice(1)).toEqual([
      expect.objectContaining({ scope: "all", batchSize: 0 }),
    ]);
    expect(latest.loadingFirstBatch).toBe(false);
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c-doc-1", "c-doc-2"],
    );
    expect(latest.progress).toEqual({ kind: "listing", pageCount: 0 });

    listing.resolve(
      response([], {
        documentIds: [],
        remainingDocumentIds: ["doc-1", "doc-2", "doc-3"],
      }),
    );
    await settle();

    expect(requests().slice(2)).toEqual([
      expect.objectContaining({
        scope: "selected",
        documentIds: ["doc-3"],
        bodyComparison: "text",
      }),
    ]);
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c-doc-1", "c-doc-2", "c-doc-3"],
    );
    expect(latest.progress).toBeNull();
    expect(latest.error).toBeNull();
  });

  it("keeps the first rows when the listing fails, and Retry asks only for the listing", async () => {
    let failListing = true;
    callAction.mockImplementation(async (_name: string, params: Request) => {
      if (params.batchSize === 0) {
        if (failListing) {
          failListing = false;
          throw new Error("Listing failed");
        }
        return response([], {
          documentIds: [],
          remainingDocumentIds: ["doc-1", "doc-2"],
        });
      }
      const ids = params.documentIds ?? [];
      return response(ids.map((id) => row(`c-${id}`, id)));
    });

    act(() =>
      root.render(
        <Probe
          documentId="page-1"
          sourceId="source-1"
          scope="all"
          priorityDocumentIds={["doc-1"]}
          enabled
        />,
      ),
    );
    await settle();

    expect(latest.error?.message).toBe("Listing failed");
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c-doc-1"],
    );

    const sentBeforeRetry = requests().length;
    act(() => latest.retry());
    await settle();

    expect(requests().slice(sentBeforeRetry)).toEqual([
      expect.objectContaining({ scope: "all", batchSize: 0 }),
      expect.objectContaining({
        scope: "selected",
        documentIds: ["doc-2"],
        bodyComparison: "text",
      }),
    ]);
    expect(latest.error).toBeNull();
    expect(latest.progress).toBeNull();
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c-doc-1", "c-doc-2"],
    );
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
      documentIds: ["doc-40", "doc-0", "doc-1", "doc-2", "doc-3"],
    });
    expect(
      Math.max(...requests().map((entry) => entry.documentIds?.length ?? 0)),
    ).toBe(20);
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
    expect(latest.data?.review?.totalRowCount).toBe(130);
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

  it("keeps the rows when a source with a page-less change is reviewed whole", async () => {
    callAction.mockImplementation(async (_name: string, params: Request) => {
      if (params.batchSize === 0) {
        return response([
          row("c1", "doc-1"),
          row("c2", "doc-2"),
          row("c-none", undefined),
        ]);
      }
      return response([row("c1", "doc-1")]);
    });

    act(() =>
      root.render(
        <Probe
          documentId="page-1"
          sourceId="source-1"
          scope="all"
          priorityDocumentIds={["doc-1"]}
          enabled
        />,
      ),
    );
    await settle();

    expect(requests()).toHaveLength(2);
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c1", "c2", "c-none"],
    );
    expect(latest.progress).toBeNull();
    expect(latest.error).toBeNull();
  });

  it("shows each batch's rows in the order sent, and holds new batches behind a slow one", async () => {
    const release = new Map<string, () => void>();
    callAction.mockImplementation(async (_name: string, params: Request) => {
      const first = params.documentIds?.[0] ?? "";
      if (!params.batchSize) {
        const gate = deferred<void>();
        release.set(first, () => gate.resolve());
        await gate.promise;
      }
      return response([row(`c-${first}`, first)]);
    });

    act(() =>
      root.render(
        <Probe
          documentId="page-1"
          sourceId="source-1"
          scope="selected"
          documentIds={pages(0, 85)}
          enabled
        />,
      ),
    );
    await settle();
    expect([...release.keys()]).toEqual(["doc-5", "doc-25", "doc-45"]);

    act(() => release.get("doc-25")?.());
    await settle();
    expect([...release.keys()]).toEqual(["doc-5", "doc-25", "doc-45"]);
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c-doc-0"],
    );

    act(() => release.get("doc-5")?.());
    await settle();
    expect([...release.keys()]).toEqual([
      "doc-5",
      "doc-25",
      "doc-45",
      "doc-65",
    ]);
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c-doc-0", "c-doc-5", "c-doc-25"],
    );
    expect(latest.progress).toEqual({ kind: "loading", pageCount: 40 });

    act(() => {
      release.get("doc-65")?.();
      release.get("doc-45")?.();
    });
    await settle();
    expect(latest.data?.review?.rows.map((entry) => entry.changeSetId)).toEqual(
      ["c-doc-0", "c-doc-5", "c-doc-25", "c-doc-45", "c-doc-65"],
    );
    expect(latest.progress).toBeNull();
  });

  it("keeps loading past the row limit until the batches already sent are in", async () => {
    const release = new Map<string, () => void>();
    callAction.mockImplementation(async (_name: string, params: Request) => {
      const first = params.documentIds?.[0] ?? "";
      if (params.batchSize) return response([row("c-doc-0", "doc-0")]);
      if (first === "doc-5") {
        return response(
          Array.from({ length: BUILDER_REVIEW_ROW_LIMIT }, (_, index) =>
            row(`c-doc-5-${index}`, "doc-5"),
          ),
        );
      }
      const gate = deferred<void>();
      release.set(first, () => gate.resolve());
      await gate.promise;
      return response([row(`c-${first}`, first)]);
    });

    act(() =>
      root.render(
        <Probe
          documentId="page-1"
          sourceId="source-1"
          scope="selected"
          documentIds={pages(0, 85)}
          enabled
        />,
      ),
    );
    await settle();
    expect(latest.data?.review?.rows).toHaveLength(BUILDER_REVIEW_ROW_LIMIT);
    expect(latest.progress).toEqual({ kind: "loading", pageCount: 40 });

    act(() => {
      release.get("doc-25")?.();
      release.get("doc-45")?.();
    });
    await settle();
    expect(latest.progress).toBeNull();
    expect(latest.moreRowsBeyondLimit).toBe(true);
    expect([...release.keys()]).toEqual(["doc-25", "doc-45"]);
  });

  it("confirms only the pages of rows within the row limit", async () => {
    const needsBlocks = new Set(pages(90, 130));
    callAction.mockImplementation(async (_name: string, params: Request) => {
      const ids = params.documentIds ?? [];
      const reviewed = params.batchSize ? ids.slice(0, params.batchSize) : ids;
      return response(
        reviewed.map((id) => row(`c-${id}`, id)),
        params.bodyComparison === "blocks"
          ? {}
          : {
              blocksCheckDocumentIds: reviewed.filter((id) =>
                needsBlocks.has(id),
              ),
              ...(params.batchSize
                ? { remainingDocumentIds: ids.slice(params.batchSize) }
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

    const confirmed = requests()
      .filter((entry) => entry.bodyComparison === "blocks")
      .flatMap((entry) => entry.documentIds ?? []);
    expect(confirmed).toEqual(pages(90, BUILDER_REVIEW_ROW_LIMIT));
    expect(latest.data?.review?.rows).toHaveLength(BUILDER_REVIEW_ROW_LIMIT);
    expect(latest.moreRowsBeyondLimit).toBe(true);
    expect(latest.progress).toBeNull();
  });

  it("confirms blocks one batch of five at a time, after the text batches", async () => {
    let blocksInFlight = 0;
    let mostBlocksInFlight = 0;
    callAction.mockImplementation(async (_name: string, params: Request) => {
      const ids = params.documentIds ?? [];
      if (params.bodyComparison === "blocks") {
        blocksInFlight += 1;
        mostBlocksInFlight = Math.max(mostBlocksInFlight, blocksInFlight);
        await Promise.resolve();
        blocksInFlight -= 1;
        return response([]);
      }
      return response(
        ids.map((id) => row(`c-${id}`, id)),
        { blocksCheckDocumentIds: ids },
      );
    });

    act(() =>
      root.render(
        <Probe
          documentId="page-1"
          sourceId="source-1"
          scope="selected"
          documentIds={pages(0, 12)}
          enabled
        />,
      ),
    );
    await settle();

    expect(
      requests().map((entry) => [entry.bodyComparison, entry.documentIds]),
    ).toEqual([
      ["text", pages(0, 5)],
      ["text", pages(5, 12)],
      ["blocks", pages(0, 5)],
      ["blocks", pages(5, 10)],
      ["blocks", pages(10, 12)],
    ]);
    expect(mostBlocksInFlight).toBe(1);
    expect(latest.unchangedRowCount).toBe(12);
    expect(latest.progress).toBeNull();
  });
});
