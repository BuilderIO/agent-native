import { describe, expect, it } from "vitest";

import type { GeometryHistorySelection } from "./history";
import {
  SELECTION_HISTORY_COALESCE_WINDOW_MS,
  selectionSnapshotsEqual,
  shouldRecordSelectionHistory,
  type SelectionHistoryEntry,
} from "./history";

function sel(
  overview: string[],
  layers: string[],
  activeFileId: string | null,
): GeometryHistorySelection {
  return {
    overviewSelectedScreenIds: overview,
    selectedLayerIds: layers,
    activeFileId,
  };
}

const A = sel(["s1"], [], "s1");
const B = sel(["s2"], [], "s2");

describe("selectionSnapshotsEqual", () => {
  it("is true for structurally identical snapshots", () => {
    expect(
      selectionSnapshotsEqual(
        sel(["s1"], ["l1"], "s1"),
        sel(["s1"], ["l1"], "s1"),
      ),
    ).toBe(true);
  });
  it("is order-sensitive on ids", () => {
    expect(
      selectionSnapshotsEqual(
        sel(["a", "b"], [], "s1"),
        sel(["b", "a"], [], "s1"),
      ),
    ).toBe(false);
  });
  it("distinguishes activeFileId", () => {
    expect(selectionSnapshotsEqual(sel([], [], "s1"), sel([], [], "s2"))).toBe(
      false,
    );
  });
  it("distinguishes layer ids", () => {
    expect(
      selectionSnapshotsEqual(sel([], ["l1"], "s1"), sel([], ["l2"], "s1")),
    ).toBe(false);
  });
});

describe("shouldRecordSelectionHistory", () => {
  it("skips while a pointer gesture is active (drag temp-selection)", () => {
    expect(
      shouldRecordSelectionHistory({
        prev: A,
        next: B,
        lastEntry: null,
        now: 1000,
        gestureActive: true,
      }),
    ).toBe("skip");
  });

  it("skips a no-op selection change", () => {
    expect(
      shouldRecordSelectionHistory({
        prev: A,
        next: sel(["s1"], [], "s1"),
        lastEntry: null,
        now: 1000,
        gestureActive: false,
      }),
    ).toBe("skip");
  });

  it("records a fresh entry when there is no prior entry", () => {
    expect(
      shouldRecordSelectionHistory({
        prev: A,
        next: B,
        lastEntry: null,
        now: 1000,
        gestureActive: false,
      }),
    ).toBe("record");
  });

  it("coalesces a change within the 800ms window of the last entry", () => {
    const lastEntry: SelectionHistoryEntry = { before: A, after: B, at: 1000 };
    expect(
      shouldRecordSelectionHistory({
        prev: B,
        next: sel(["s3"], [], "s3"),
        lastEntry,
        now: 1000 + SELECTION_HISTORY_COALESCE_WINDOW_MS - 1,
        gestureActive: false,
      }),
    ).toBe("coalesce");
  });

  it("records a fresh entry once the coalesce window has elapsed", () => {
    const lastEntry: SelectionHistoryEntry = { before: A, after: B, at: 1000 };
    expect(
      shouldRecordSelectionHistory({
        prev: B,
        next: sel(["s3"], [], "s3"),
        lastEntry,
        now: 1000 + SELECTION_HISTORY_COALESCE_WINDOW_MS + 1,
        gestureActive: false,
      }),
    ).toBe("record");
  });

  it("still skips a no-op even inside the coalesce window", () => {
    const lastEntry: SelectionHistoryEntry = { before: A, after: B, at: 1000 };
    expect(
      shouldRecordSelectionHistory({
        prev: B,
        next: sel(["s2"], [], "s2"),
        lastEntry,
        now: 1100,
        gestureActive: false,
      }),
    ).toBe("skip");
  });

  it("honors a custom coalesce window", () => {
    const lastEntry: SelectionHistoryEntry = { before: A, after: B, at: 0 };
    expect(
      shouldRecordSelectionHistory({
        prev: B,
        next: A,
        lastEntry,
        now: 50,
        gestureActive: false,
        coalesceWindowMs: 100,
      }),
    ).toBe("coalesce");
    expect(
      shouldRecordSelectionHistory({
        prev: B,
        next: A,
        lastEntry,
        now: 150,
        gestureActive: false,
        coalesceWindowMs: 100,
      }),
    ).toBe("record");
  });
});
