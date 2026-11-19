import type {
  ContentDatabaseSourceReviewPayload,
  ContentDatabaseSourceReviewRowSummary,
} from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  BUILDER_REVIEW_ROW_LIMIT,
  builderReviewReplacedRowIds,
  chunkBuilderReviewIds,
  composeBuilderReviewIdRemap,
  mergeBuilderReviewBatch,
  prioritizedBuilderReviewDocumentIds,
} from "./builder-review-batches";

function row(
  changeSetId: string,
  documentId: string | null,
  overrides: Partial<ContentDatabaseSourceReviewRowSummary> = {},
): ContentDatabaseSourceReviewRowSummary {
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
    ...overrides,
  } as ContentDatabaseSourceReviewRowSummary;
}

function review(
  rows: ContentDatabaseSourceReviewRowSummary[],
  result: ContentDatabaseSourceReviewPayload["result"] = {
    status: "write_disabled",
    message: "Writes are off.",
  },
): ContentDatabaseSourceReviewPayload {
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
    result,
  };
}

const ids = (payload: ContentDatabaseSourceReviewPayload | null) =>
  payload?.rows.map((entry) => entry.changeSetId);

describe("mergeBuilderReviewBatch", () => {
  it("adds a batch's rows after the rows loaded so far", () => {
    const merged = mergeBuilderReviewBatch(
      review([row("a", "doc-a")]),
      review([row("b", "doc-b")]),
    );
    expect(ids(merged)).toEqual(["a", "b"]);
    expect(merged?.totalRowCount).toBe(2);
    expect(merged?.summary).toBe(
      "2 Builder rows have changes ready to review.",
    );
  });

  it("replaces a page's rows in place and drops pages the batch found unchanged", () => {
    const merged = mergeBuilderReviewBatch(
      review([row("a", "doc-a"), row("b", "doc-b"), row("c", "doc-c")]),
      review([row("a2", "doc-a"), row("d", "doc-d")]),
      ["doc-a", "doc-b"],
    );
    expect(ids(merged)).toEqual(["a2", "c", "d"]);
  });

  it("is empty once every row is dropped", () => {
    expect(
      mergeBuilderReviewBatch(review([row("a", "doc-a")]), null, ["doc-a"]),
    ).toBeNull();
    expect(mergeBuilderReviewBatch(null, null)).toBeNull();
  });

  it("takes risk from the rows it keeps", () => {
    const merged = mergeBuilderReviewBatch(
      review([row("a", "doc-a", { riskLevel: "high", riskReasons: ["big"] })]),
      review([row("b", "doc-b", { conflictState: "source_changed" })]),
      ["doc-a"],
    );
    expect(merged?.riskLevel).toBe("medium");
    expect(merged?.riskReasons).toEqual(["source changed"]);
  });

  it("keeps the most pressing result", () => {
    const merged = mergeBuilderReviewBatch(
      review([row("a", "doc-a")], { status: "validated", message: "ok" }),
      review([row("b", "doc-b")], { status: "blocked", message: "attention" }),
    );
    expect(merged?.result).toEqual({ status: "blocked", message: "attention" });
    expect(
      mergeBuilderReviewBatch(
        review([row("a", "doc-a")], { status: "succeeded", message: "done" }),
        review([row("b", "doc-b")], { status: "validated", message: "ok" }),
      )?.result.status,
    ).toBe("validated");
  });

  it("shows at most the row limit and counts the rest", () => {
    const many = Array.from({ length: BUILDER_REVIEW_ROW_LIMIT + 3 }, (_, i) =>
      row(`row-${i}`, `doc-${i}`),
    );
    const merged = mergeBuilderReviewBatch(null, review(many));
    expect(merged?.rows).toHaveLength(BUILDER_REVIEW_ROW_LIMIT);
    expect(merged?.totalRowCount).toBe(BUILDER_REVIEW_ROW_LIMIT + 3);
  });

  it("keeps every row when the limit is lifted", () => {
    const many = Array.from({ length: BUILDER_REVIEW_ROW_LIMIT + 3 }, (_, i) =>
      row(`row-${i}`, `doc-${i}`),
    );
    const merged = mergeBuilderReviewBatch(null, review(many), [], null);
    expect(merged?.rows).toHaveLength(BUILDER_REVIEW_ROW_LIMIT + 3);
    expect(merged?.totalRowCount).toBe(BUILDER_REVIEW_ROW_LIMIT + 3);
  });
});

describe("review row id remaps", () => {
  it("maps a replaced page's old row id to its new one", () => {
    expect(
      builderReviewReplacedRowIds(
        [row("a", "doc-a"), row("b", "doc-b"), row("c", "doc-c")],
        [row("a2", "doc-a"), row("b", "doc-b"), row("c", "doc-c")],
        ["doc-a", "doc-b"],
      ),
    ).toEqual({ a: "a2" });
  });

  it("follows an earlier id through a later remap", () => {
    expect(composeBuilderReviewIdRemap({ a: "b" }, { b: "c", x: "y" })).toEqual(
      { a: "c", b: "c", x: "y" },
    );
  });
});

describe("prioritizedBuilderReviewDocumentIds", () => {
  it("puts pages with a recorded change first, in their own order", () => {
    expect(
      prioritizedBuilderReviewDocumentIds(
        ["a", "b", "c", "d", "e"],
        ["x", "d", "b"],
      ),
    ).toEqual(["b", "d", "a", "c", "e"]);
  });
});

describe("chunkBuilderReviewIds", () => {
  it("splits ids into consecutive chunks", () => {
    expect(chunkBuilderReviewIds(["a", "b", "c"], 2)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    expect(chunkBuilderReviewIds([], 2)).toEqual([]);
  });
});
