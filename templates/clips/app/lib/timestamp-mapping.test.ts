import { describe, expect, it } from "vitest";

import {
  lastKeptMs,
  DEFAULT_EDITS,
  addCut,
  addSplitAt,
  buildTimelinePieces,
  editedToOriginal,
  effectiveDuration,
  getCuts,
  getSplits,
  moveSplit,
  originalToEdited,
  parseEdits,
  removeCut,
  removeSplit,
  serializeEdits,
  skipExcludedRange,
  updateCut,
  visibleSplitPoints,
} from "./timestamp-mapping";

const editsWithCuts = {
  version: 1 as const,
  trims: [
    { startMs: 1_000, endMs: 2_000, excluded: true },
    { startMs: 4_000, endMs: 4_500, excluded: true },
  ],
  blurs: [],
};

describe("edited playback timeline", () => {
  it("collapses excluded ranges into the visible duration", () => {
    expect(effectiveDuration(10_000, editsWithCuts)).toBe(8_500);
    expect(originalToEdited(2_500, editsWithCuts)).toBe(1_500);
    expect(originalToEdited(4_250, editsWithCuts)).toBe(3_000);
  });

  it("maps visible scrubber positions back to source timestamps", () => {
    expect(editedToOriginal(1_500, editsWithCuts)).toBe(2_500);
    expect(editedToOriginal(3_000, editsWithCuts)).toBe(4_500);
    expect(editedToOriginal(8_500, editsWithCuts)).toBe(10_000);
  });

  it("keeps reaction timestamps anchored to the original video timeline", () => {
    expect(editedToOriginal(1_500, editsWithCuts)).toBe(2_500);
  });
});

describe("skipExcludedRange", () => {
  const cuts = [
    { startMs: 1_000, endMs: 2_000 },
    { startMs: 3_000, endMs: 3_500 },
  ];

  it("leaves visible timestamps unchanged", () => {
    expect(skipExcludedRange(500, cuts, 5_000)).toBe(500);
    expect(skipExcludedRange(2_500, cuts, 5_000)).toBe(2_500);
  });

  it("jumps to the end of the cut", () => {
    expect(skipExcludedRange(1_250, cuts, 5_000)).toBe(2_000);
    expect(skipExcludedRange(3_100, cuts, 5_000)).toBe(3_500);
  });

  it("does not seek past the known duration", () => {
    expect(
      skipExcludedRange(4_900, [{ startMs: 4_000, endMs: 6_000 }], 5_000),
    ).toBe(5_000);
  });
});

describe("Rewind original-start provenance", () => {
  it("round-trips a positive countdown-complete boundary", () => {
    const parsed = parseEdits(
      serializeEdits({
        version: 1,
        trims: [],
        blurs: [],
        rewindOriginalStartMs: 30_042.4,
      }),
    );

    expect(parsed.rewindOriginalStartMs).toBe(30_042);
  });

  it("drops invalid or non-positive boundaries", () => {
    expect(
      parseEdits('{"rewindOriginalStartMs":0}').rewindOriginalStartMs,
    ).toBeUndefined();
    expect(
      parseEdits('{"rewindOriginalStartMs":"30000"}').rewindOriginalStartMs,
    ).toBeUndefined();
  });
});

describe("trim identity", () => {
  it("backfills an id for trims written before ids existed", () => {
    const parsed = parseEdits(
      '{"trims":[{"startMs":1000,"endMs":2000,"excluded":true}]}',
    );
    expect(parsed.trims[0].id).toBe("cut-1000-2000-0");
  });

  it("keeps an id it is given, and survives a round trip", () => {
    const once = parseEdits(
      serializeEdits(addCut(DEFAULT_EDITS, 1_000, 2_000, "cut-abc")),
    );
    const twice = parseEdits(serializeEdits(once));
    expect(twice.trims[0].id).toBe("cut-abc");
  });

  it("tells two identical split markers apart", () => {
    const parsed = parseEdits(
      '{"trims":[{"startMs":500,"endMs":500,"excluded":false},{"startMs":500,"endMs":500,"excluded":false}]}',
    );
    expect(parsed.trims[0].id).not.toBe(parsed.trims[1].id);
  });
});

describe("timeline pieces", () => {
  const withCut = addCut(DEFAULT_EDITS, 2_000, 3_000, "cut-a");

  it("is a single clip when nothing has been edited", () => {
    expect(buildTimelinePieces(10_000, DEFAULT_EDITS)).toEqual([
      { kind: "clip", id: "clip-0-10000", startMs: 0, endMs: 10_000 },
    ]);
  });

  it("puts a gap between the clips either side of a cut", () => {
    expect(
      buildTimelinePieces(10_000, withCut).map((p) => [
        p.kind,
        p.startMs,
        p.endMs,
      ]),
    ).toEqual([
      ["clip", 0, 2_000],
      ["gap", 2_000, 3_000],
      ["clip", 3_000, 10_000],
    ]);
  });

  it("divides a clip at a split marker", () => {
    const pieces = buildTimelinePieces(
      10_000,
      addSplitAt(DEFAULT_EDITS, 4_000, "split-a"),
    );
    expect(pieces.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 4_000],
      [4_000, 10_000],
    ]);
    expect(pieces.every((p) => p.kind === "clip")).toBe(true);
  });

  it("ignores a split that has ended up inside a gap", () => {
    const edits = addSplitAt(withCut, 2_500, "split-inside");
    expect(buildTimelinePieces(10_000, edits)).toHaveLength(3);
  });

  it("carries the cut id on the gap, so it can be edited later", () => {
    const gap = buildTimelinePieces(10_000, withCut)[1];
    expect(gap.kind === "gap" && gap.cutId).toBe("cut-a");
  });

  it("clips a cut that runs past the end of the recording", () => {
    const edits = addCut(DEFAULT_EDITS, 9_000, 30_000, "cut-tail");
    expect(
      buildTimelinePieces(10_000, edits).map((p) => [p.kind, p.endMs]),
    ).toEqual([
      ["clip", 9_000],
      ["gap", 10_000],
    ]);
  });
});

describe("editing a cut after the fact", () => {
  const base = addCut(DEFAULT_EDITS, 2_000, 3_000, "cut-a");

  it("moves one edge and leaves the id alone", () => {
    const next = updateCut(base, "cut-a", 2_000, 5_000);
    expect(getCuts(next)).toEqual([
      { id: "cut-a", startMs: 2_000, endMs: 5_000, excluded: true },
    ]);
  });

  it("drops the cut when its edges are dragged shut", () => {
    expect(getCuts(updateCut(base, "cut-a", 2_500, 2_500))).toEqual([]);
  });

  it("merges two cuts that meet, keeping the earlier id", () => {
    const two = addCut(base, 4_000, 5_000, "cut-b");
    const merged = getCuts(updateCut(two, "cut-a", 2_000, 4_200));
    expect(merged).toEqual([
      { id: "cut-a", startMs: 2_000, endMs: 5_000, excluded: true },
    ]);
  });

  it("ignores an id that is not there", () => {
    expect(updateCut(base, "cut-missing", 0, 500)).toBe(base);
  });

  it("puts the footage back when a cut is removed", () => {
    expect(effectiveDuration(10_000, removeCut(base, "cut-a"))).toBe(10_000);
  });

  it("keeps split markers through a cut edit", () => {
    const edits = updateCut(
      addSplitAt(base, 8_000, "split-a"),
      "cut-a",
      2_000,
      4_000,
    );
    expect(getSplits(edits).map((s) => s.startMs)).toEqual([8_000]);
  });
});

describe("split markers", () => {
  it("does not stack a second marker on the same spot", () => {
    const once = addSplitAt(DEFAULT_EDITS, 4_000, "split-a");
    expect(getSplits(addSplitAt(once, 4_000, "split-b"))).toHaveLength(1);
  });

  it("slides to a new position", () => {
    const moved = moveSplit(
      addSplitAt(DEFAULT_EDITS, 4_000, "split-a"),
      "split-a",
      6_000,
    );
    expect(getSplits(moved)[0]).toMatchObject({ startMs: 6_000, endMs: 6_000 });
  });

  it("rejoins the clips when removed", () => {
    const edits = removeSplit(
      addSplitAt(DEFAULT_EDITS, 4_000, "split-a"),
      "split-a",
    );
    expect(buildTimelinePieces(10_000, edits)).toHaveLength(1);
  });

  it("never changes the visible duration", () => {
    const edits = addSplitAt(DEFAULT_EDITS, 4_000, "split-a");
    expect(effectiveDuration(10_000, edits)).toBe(10_000);
  });
});

describe("what gets written back", () => {
  it("stores whole milliseconds, whatever the pointer handed over", () => {
    const edits = addCut(DEFAULT_EDITS, 3_511.4, 8_920.666, "cut-a");
    expect(getCuts(edits)[0]).toMatchObject({ startMs: 3_511, endMs: 8_921 });
    for (const trim of edits.trims) {
      expect(Number.isInteger(trim.startMs)).toBe(true);
      expect(Number.isInteger(trim.endMs)).toBe(true);
    }
  });

  it("rounds a fractional marker too", () => {
    const edits = addSplitAt(DEFAULT_EDITS, 4_000.7, "split-a");
    expect(getSplits(edits)[0]).toMatchObject({ startMs: 4_001, endMs: 4_001 });
  });

  it("carries a field it has never heard of through untouched", () => {
    const stored = JSON.stringify({
      version: 1,
      trims: [],
      blurs: [],
      overlays: [{ id: "o1", kind: "text", startMs: 0, endMs: 1_000 }],
    });
    const round = JSON.parse(serializeEdits(parseEdits(stored)));
    expect(round.overlays).toEqual([
      { id: "o1", kind: "text", startMs: 0, endMs: 1_000 },
    ]);
  });

  it("still drops a field it knows to be malformed", () => {
    const stored = JSON.stringify({ trims: [], stitchedFrom: "not-a-list" });
    expect(parseEdits(stored).stitchedFrom).toBeUndefined();
  });
});

describe("which split markers are worth drawing", () => {
  it("draws one that still has footage either side", () => {
    const edits = addSplitAt(DEFAULT_EDITS, 4_000, "split-a");
    expect(visibleSplitPoints(edits, 10_000)).toEqual([4_000]);
  });

  it("stops drawing one that a cut has since swallowed", () => {
    const edits = addCut(
      addSplitAt(DEFAULT_EDITS, 4_000, "split-a"),
      3_000,
      6_000,
      "cut-a",
    );
    expect(visibleSplitPoints(edits, 10_000)).toEqual([]);
  });

  it("draws it again once the cut is pulled back off it", () => {
    const cut = addCut(
      addSplitAt(DEFAULT_EDITS, 4_000, "split-a"),
      3_000,
      6_000,
      "cut-a",
    );
    const reopened = removeCut(cut, "cut-a");
    expect(visibleSplitPoints(reopened, 10_000)).toEqual([4_000]);
  });

  it("keeps the one sitting on a cut's edge, which still divides", () => {
    const edits = addCut(
      addSplitAt(DEFAULT_EDITS, 4_000, "split-a"),
      4_000,
      6_000,
      "cut-a",
    );
    expect(visibleSplitPoints(edits, 10_000)).toEqual([4_000]);
  });

  it("leaves out markers on the very ends", () => {
    const edits = addSplitAt(
      addSplitAt(DEFAULT_EDITS, 0, "split-head"),
      10_000,
      "split-tail",
    );
    expect(visibleSplitPoints(edits, 10_000)).toEqual([]);
  });
});

describe("lastKeptMs", () => {
  it("pulls the end back to where a trimmed tail begins", () => {
    expect(lastKeptMs(10_000, [{ startMs: 7_000, endMs: 10_000 }])).toBe(7_000);
  });

  it("leaves the end alone when the cut stops short of it", () => {
    expect(lastKeptMs(10_000, [{ startMs: 4_000, endMs: 6_000 }])).toBe(10_000);
  });

  it("takes the earliest of several cuts that run to the end", () => {
    expect(
      lastKeptMs(10_000, [
        { startMs: 9_000, endMs: 10_000 },
        { startMs: 8_000, endMs: 9_000 },
      ]),
    ).toBe(8_000);
  });

  it("is zero when everything has been cut, and when there is no duration", () => {
    expect(lastKeptMs(10_000, [{ startMs: 0, endMs: 10_000 }])).toBe(0);
    expect(lastKeptMs(0, [])).toBe(0);
  });
});
