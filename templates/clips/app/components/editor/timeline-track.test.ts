import { describe, expect, it } from "vitest";

import {
  DEFAULT_EDITS,
  addCut,
  addSplitAt,
  buildTimelinePieces,
  getCuts,
  getSplits,
  type EditsJson,
} from "@/lib/timestamp-mapping";

import {
  applyDrag,
  boundarySide,
  edgeDragTarget,
  trackBoundaries,
  type EdgeSide,
  type TrackSelection,
} from "./timeline-track";

const DURATION = 10_000;

const boundariesOf = (edits: EditsJson) =>
  trackBoundaries(buildTimelinePieces(DURATION, edits));

function drag(
  edits: EditsJson,
  atMs: number,
  side: EdgeSide,
  toMs: number,
): EditsJson {
  const boundary = boundariesOf(edits).find((b) => b.atMs === atMs);
  expect(boundary, `no boundary at ${atMs}`).toBeTruthy();
  const target = edgeDragTarget(edits, boundary!, side, "cut-new");
  expect(target).toBeTruthy();
  return applyDrag(edits, DURATION, target!, toMs);
}

describe("the boundaries of the timeline", () => {
  it("finds the split between two sections", () => {
    expect(boundariesOf(addSplitAt(DEFAULT_EDITS, 4_000, "split-a"))).toEqual([
      {
        atMs: 4_000,
        left: { startMs: 0, endMs: 4_000 },
        right: { startMs: 4_000, endMs: 10_000 },
        cutId: null,
      },
    ]);
  });

  it("gives a gap one boundary per edge, each owned by the section beside it", () => {
    expect(boundariesOf(addCut(DEFAULT_EDITS, 3_000, 6_000, "cut-a"))).toEqual([
      {
        atMs: 3_000,
        left: { startMs: 0, endMs: 3_000 },
        right: null,
        cutId: "cut-a",
      },
      {
        atMs: 6_000,
        left: null,
        right: { startMs: 6_000, endMs: 10_000 },
        cutId: "cut-a",
      },
    ]);
  });

  it("leaves nothing to grab on the outside of a gap at the very start", () => {
    const edits = addCut(DEFAULT_EDITS, 0, 2_000, "cut-a");
    expect(boundariesOf(edits)).toHaveLength(1);
    expect(boundariesOf(edits)[0]).toMatchObject({ atMs: 2_000, left: null });
  });
});

describe("which end of a boundary a press picks up", () => {
  const split = addSplitAt(DEFAULT_EDITS, 4_000, "split-a");
  const boundary = () => boundariesOf(split)[0];

  it("hands a split to the section on the left by default", () => {
    expect(boundarySide(boundary(), null)).toBe("clip-end");
  });

  it("still hands it left when the left-hand section is the selected one", () => {
    const selection: TrackSelection = { kind: "clip", anchorMs: 1_000 };
    expect(boundarySide(boundary(), selection)).toBe("clip-end");
  });

  it("hands it to the right-hand section once that one is selected", () => {
    const selection: TrackSelection = { kind: "clip", anchorMs: 7_000 };
    expect(boundarySide(boundary(), selection)).toBe("clip-start");
  });

  it("has only one answer at the edge of a gap", () => {
    const [start, end] = boundariesOf(
      addCut(DEFAULT_EDITS, 3_000, 6_000, "cut-a"),
    );
    expect(boundarySide(start, { kind: "clip", anchorMs: 8_000 })).toBe(
      "clip-end",
    );
    expect(boundarySide(end, { kind: "clip", anchorMs: 1_000 })).toBe(
      "clip-start",
    );
  });
});

describe("dragging a split", () => {
  const split = addSplitAt(DEFAULT_EDITS, 4_000, "split-a");

  it("removes what the left-hand section is dragged past", () => {
    expect(getCuts(drag(split, 4_000, "clip-end", 2_500))).toEqual([
      { id: "cut-new", startMs: 2_500, endMs: 4_000, excluded: true },
    ]);
  });

  it("will not let the left-hand section reach past the split", () => {
    expect(getCuts(drag(split, 4_000, "clip-end", 7_000))).toEqual([]);
  });

  it("removes what the right-hand section is dragged past", () => {
    expect(getCuts(drag(split, 4_000, "clip-start", 5_500))).toEqual([
      { id: "cut-new", startMs: 4_000, endMs: 5_500, excluded: true },
    ]);
  });

  it("will not let the right-hand section reach back past the split", () => {
    expect(getCuts(drag(split, 4_000, "clip-start", 1_000))).toEqual([]);
  });

  it("makes no cut at all when the drag never travels far enough", () => {
    expect(getCuts(drag(split, 4_000, "clip-end", 3_950))).toEqual([]);
  });

  it("leaves the split marker where it is", () => {
    expect(getSplits(drag(split, 4_000, "clip-end", 2_500))[0].startMs).toBe(
      4_000,
    );
  });

  it("keeps whole milliseconds, whatever the pointer lands on", () => {
    const cut = getCuts(drag(split, 4_000, "clip-end", 2_500.666))[0];
    expect(cut.startMs).toBe(2_501);
  });
});

describe("dragging the edge of a gap", () => {
  const base = addCut(DEFAULT_EDITS, 3_000, 6_000, "cut-a");

  it("moves the gap it is already touching rather than opening another", () => {
    const next = drag(base, 3_000, "clip-end", 1_500);
    expect(getCuts(next)).toEqual([
      { id: "cut-a", startMs: 1_500, endMs: 6_000, excluded: true },
    ]);
  });

  it("gives footage back when the edge is pushed the other way", () => {
    expect(getCuts(drag(base, 3_000, "clip-end", 4_500))).toEqual([
      { id: "cut-a", startMs: 4_500, endMs: 6_000, excluded: true },
    ]);
  });

  it("moves the far edge from the section on the right", () => {
    expect(getCuts(drag(base, 6_000, "clip-start", 7_500))).toEqual([
      { id: "cut-a", startMs: 3_000, endMs: 7_500, excluded: true },
    ]);
  });

  it("closes the gap when an edge is pushed onto the other one", () => {
    const next = drag(base, 3_000, "clip-end", 6_000);
    expect(getCuts(next)).toEqual([]);
    expect(buildTimelinePieces(DURATION, next)).toHaveLength(1);
  });

  it("puts the whole gap back rather than eating the section beyond it", () => {
    expect(getCuts(drag(base, 6_000, "clip-start", 2_000))).toEqual([]);
  });

  it("stays inside the section it belongs to", () => {
    expect(getCuts(drag(base, 6_000, "clip-start", 50_000))[0].endMs).toBe(
      DURATION,
    );
  });

  it("ignores a gap that has since been removed", () => {
    const target = edgeDragTarget(
      base,
      boundariesOf(base)[0],
      "clip-end",
      "cut-new",
    )!;
    const gone = { ...base, trims: [] };
    expect(applyDrag(gone, DURATION, target, 1_000)).toBe(gone);
  });
});

describe("a section deleted between two cuts", () => {
  const twoSplits = addSplitAt(
    addSplitAt(DEFAULT_EDITS, 3_000, "split-a"),
    6_000,
    "split-b",
  );
  const middleGone = addCut(twoSplits, 3_000, 6_000, "cut-mid");

  it("can still be trimmed further from the left", () => {
    expect(getCuts(drag(middleGone, 3_000, "clip-end", 2_000))).toEqual([
      { id: "cut-mid", startMs: 2_000, endMs: 6_000, excluded: true },
    ]);
  });

  it("can still be trimmed further from the right", () => {
    expect(getCuts(drag(middleGone, 6_000, "clip-start", 7_000))).toEqual([
      { id: "cut-mid", startMs: 3_000, endMs: 7_000, excluded: true },
    ]);
  });

  it("puts its split markers back when the gap is reopened", () => {
    const reopened = drag(middleGone, 3_000, "clip-end", 6_000);
    expect(getCuts(reopened)).toEqual([]);
    expect(getSplits(reopened).map((s) => s.startMs)).toEqual([3_000, 6_000]);
  });

  it("never leaves a second gap behind when dragged again and again", () => {
    let edits = middleGone;
    for (const to of [2_500, 2_000, 1_000, 2_200]) {
      edits = drag(edits, getCuts(edits)[0].startMs, "clip-end", to);
    }
    expect(getCuts(edits)).toEqual([
      { id: "cut-mid", startMs: 2_200, endMs: 6_000, excluded: true },
    ]);
  });
});
