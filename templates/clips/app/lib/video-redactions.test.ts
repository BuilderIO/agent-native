import { describe, expect, it } from "vitest";

import {
  clampRedactionToDuration,
  MAX_BURN_FPS,
  redactionBurnFfmpegArgs,
  DEFAULT_REDACTION_COLOR,
  MOSAIC_PALETTE,
  REDACTION_EDGE_COLOR,
  isRedactionActiveAt,
  moveRedactionKey,
  otherOverlays,
  parseRedactions,
  redactionFilterGraph,
  redactionRectAt,
  redactionSegments,
  removeRedactionKey,
  setRedactionKey,
  setRedactionRange,
  type VideoRedaction,
} from "./video-redactions";

const still: VideoRedaction = {
  id: "r1",
  kind: "redact",
  style: "mosaic",
  startMs: 1_000,
  endMs: 4_000,
  keys: [{ atMs: 1_000, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
};

const moving: VideoRedaction = {
  ...still,
  id: "r2",
  keys: [
    { atMs: 1_000, x: 0.1, y: 0.2, w: 0.2, h: 0.1 },
    { atMs: 3_000, x: 0.1, y: 0.6, w: 0.2, h: 0.1 },
  ],
};

describe("reading redactions off the edit document", () => {
  it("keeps a well-formed one", () => {
    expect(parseRedactions([still])).toEqual([still]);
  });

  it("defaults to a mosaic, and keeps a solid one solid", () => {
    expect(parseRedactions([{ ...still, style: undefined }])[0].style).toBe(
      "mosaic",
    );
    expect(parseRedactions([{ ...still, style: "solid" }])[0].style).toBe(
      "solid",
    );
    expect(parseRedactions([{ ...still, style: "blur" }])[0].style).toBe(
      "mosaic",
    );
  });

  it("drops one with no position at all", () => {
    expect(parseRedactions([{ ...still, keys: [] }])).toEqual([]);
  });

  it("drops a box too small to have been meant", () => {
    const speck = {
      ...still,
      keys: [{ atMs: 0, x: 0.5, y: 0.5, w: 0.0001, h: 0.2 }],
    };
    expect(parseRedactions([speck])).toEqual([]);
  });

  it("pulls a box that hangs off the edge back inside the frame", () => {
    const over = {
      ...still,
      keys: [{ atMs: 0, x: 0.8, y: 0.1, w: 0.5, h: 0.2 }],
    };
    const key = parseRedactions([over])[0].keys[0];
    expect(key.x).toBeCloseTo(0.8, 6);
    expect(key.w).toBeCloseTo(0.2, 6);
  });

  it("ignores an overlay kind it has never heard of, and leaves it alone", () => {
    const list = [still, { id: "t1", kind: "text", text: "hi" }];
    expect(parseRedactions(list)).toEqual([still]);
    expect(otherOverlays(list)).toEqual([
      { id: "t1", kind: "text", text: "hi" },
    ]);
  });

  it("sorts the waypoints even when they arrive out of order", () => {
    const jumbled = { ...moving, keys: [moving.keys[1], moving.keys[0]] };
    expect(parseRedactions([jumbled])[0].keys.map((k) => k.atMs)).toEqual([
      1_000, 3_000,
    ]);
  });
});

describe("where the box is at a given moment", () => {
  it("holds still when it was never moved", () => {
    expect(redactionRectAt(still, 3_500)).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.1,
    });
  });

  it("slides between two waypoints", () => {
    expect(redactionRectAt(moving, 2_000).y).toBeCloseTo(0.4, 6);
  });

  it("holds still before the first waypoint and after the last", () => {
    expect(redactionRectAt(moving, 0).y).toBeCloseTo(0.2, 6);
    expect(redactionRectAt(moving, 99_000).y).toBeCloseTo(0.6, 6);
  });

  it("knows when it is covering something", () => {
    expect(isRedactionActiveAt(still, 999)).toBe(false);
    expect(isRedactionActiveAt(still, 1_000)).toBe(true);
    expect(isRedactionActiveAt(still, 4_000)).toBe(false);
  });
});

describe("placing waypoints", () => {
  it("adds one and keeps the list in order", () => {
    const next = setRedactionKey(still, 2_000, {
      x: 0.5,
      y: 0.5,
      w: 0.2,
      h: 0.2,
    });
    expect(next.keys.map((k) => k.atMs)).toEqual([1_000, 2_000]);
  });

  it("replaces one placed at the same spot rather than stacking", () => {
    const once = setRedactionKey(still, 2_000, {
      x: 0.5,
      y: 0.5,
      w: 0.2,
      h: 0.2,
    });
    const twice = setRedactionKey(once, 2_050, {
      x: 0.6,
      y: 0.5,
      w: 0.2,
      h: 0.2,
    });
    expect(twice.keys).toHaveLength(2);
    expect(twice.keys[1]).toMatchObject({ atMs: 2_050, x: 0.6 });
  });

  it("slides one along the timeline, keeping the box where it is", () => {
    const moved = moveRedactionKey(moving, 3_000, 2_000);
    expect(moved.keys.map((k) => k.atMs)).toEqual([1_000, 2_000]);
    expect(moved.keys[1]).toMatchObject({ y: 0.6 });
    expect(redactionRectAt(moved, 2_000).y).toBeCloseTo(0.6, 6);
    expect(redactionRectAt(moved, 1_500).y).toBeCloseTo(0.4, 6);
  });

  it("keeps the waypoints in order when one is dragged past another", () => {
    const three = setRedactionKey(moving, 2_000, {
      x: 0.5,
      y: 0.5,
      w: 0.2,
      h: 0.1,
    });
    const moved = moveRedactionKey(three, 2_000, 4_000);
    expect(moved.keys.map((k) => k.atMs)).toEqual([1_000, 3_000, 4_000]);
  });

  it("replaces the one it is dropped on", () => {
    const moved = moveRedactionKey(moving, 1_000, 3_020);
    expect(moved.keys).toHaveLength(1);
    expect(moved.keys[0]).toMatchObject({ atMs: 3_020, y: 0.2 });
  });

  it("ignores a waypoint that is not there", () => {
    expect(moveRedactionKey(moving, 9_999, 2_000)).toBe(moving);
  });

  it("will not remove the only one it has", () => {
    expect(removeRedactionKey(still, 1_000).keys).toHaveLength(1);
  });

  it("keeps waypoints when the time range is shortened", () => {
    const shorter = setRedactionRange(moving, 1_500, 2_500);
    expect(shorter.keys).toHaveLength(2);
    expect(redactionRectAt(shorter, 2_000).y).toBeCloseTo(0.4, 6);
  });
});

describe("cutting a redaction into stretches", () => {
  it("gives a still box one stretch", () => {
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    expect(redactionSegments(still)).toEqual([
      { fromMs: 1_000, toMs: 4_000, from: rect, to: rect },
    ]);
  });

  it("gives a movement one stretch, however long it lasts", () => {
    const segs = redactionSegments(moving);
    expect(segs.map((s) => [s.fromMs, s.toMs])).toEqual([
      [1_000, 3_000],
      [3_000, 4_000],
    ]);
    expect(segs[0].from.y).toBeCloseTo(0.2, 6);
    expect(segs[0].to.y).toBeCloseTo(0.6, 6);
    expect(segs[1].from).toEqual(segs[1].to);
  });

  it("stays one stretch even over ten minutes", () => {
    const marathon: VideoRedaction = {
      ...moving,
      startMs: 0,
      endMs: 600_000,
      keys: [
        { atMs: 0, x: 0, y: 0, w: 0.2, h: 0.1 },
        { atMs: 600_000, x: 0.7, y: 0.8, w: 0.2, h: 0.1 },
      ],
    };
    expect(redactionSegments(marathon)).toHaveLength(1);
  });

  it("never covers more than the recording holds", () => {
    const clipped = redactionSegments(still, 2_500);
    expect(clipped[clipped.length - 1].toMs).toBe(2_500);
  });

  it("covers nothing when the range sits past the end", () => {
    expect(
      redactionSegments({ ...still, startMs: 9_000, endMs: 9_500 }, 5_000),
    ).toEqual([]);
  });
});

describe("the ffmpeg filter graph", () => {
  const solid = { ...still, style: "solid" as const };

  it("maps nothing when there is nothing to draw", () => {
    expect(redactionFilterGraph([])).toEqual({
      filterComplex: "",
      outputLabel: "0:v",
    });
  });

  it("crops the box out first, then destroys only that piece", () => {
    const { filterComplex, outputLabel } = redactionFilterGraph(
      [still],
      10_000,
      1_920,
      1_080,
    );
    expect(filterComplex).toContain("[0:v]split=2[rbase][rsrc0]");
    expect(filterComplex).toContain(
      "[rsrc0]crop=w='iw*0.300000':h='ih*0.100000'",
    );
    expect(filterComplex).toMatch(/\[rc0\]scale=\d+:\d+:flags=neighbor,geq=/);
    expect(filterComplex).toContain("gblur=sigma=34.0");
    expect(filterComplex).toContain(`color=${REDACTION_EDGE_COLOR}@1`);
    expect(filterComplex).toContain("[rbase][rd0]overlay=eval=frame:");
    expect(filterComplex).toContain("enable='between(t,1.000,4.000)'");
    expect(outputLabel).toBe("rv0");
  });

  it("fills the crop for a solid box, not the frame", () => {
    const { filterComplex } = redactionFilterGraph(
      [solid],
      10_000,
      1_920,
      1_080,
    );
    expect(filterComplex).toContain(
      `[rc0]drawbox=x=0:y=0:w=iw:h=ih:color=0x${DEFAULT_REDACTION_COLOR.slice(1)}@1:t=fill,`,
    );
  });

  it("moves the crop and the overlay together, per frame", () => {
    const { filterComplex } = redactionFilterGraph(
      [moving],
      10_000,
      1_280,
      720,
    );
    expect(filterComplex).toContain("ih*(0.200000+(0.200000)*(t-1.000))");
    expect(filterComplex).toContain("H*(0.200000+(0.200000)*(t-1.000))");
    expect(filterComplex).toContain("eval=frame");
  });

  it("clamps the box inside the frame, whatever the arithmetic says", () => {
    const { filterComplex } = redactionFilterGraph(
      [moving],
      10_000,
      1_280,
      720,
    );
    expect(filterComplex).toContain("min(max(");
    expect(filterComplex).toContain("iw-out_w");
    expect(filterComplex).toContain("W-w");
  });

  it("takes the size of a growing box from its largest moment", () => {
    const growing: VideoRedaction = {
      ...still,
      keys: [
        { atMs: 1_000, x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
        { atMs: 4_000, x: 0.1, y: 0.1, w: 0.4, h: 0.3 },
      ],
    };
    const { filterComplex } = redactionFilterGraph(
      [growing],
      10_000,
      1_280,
      720,
    );
    expect(filterComplex).toContain("crop=w='iw*0.400000':h='ih*0.300000'");
  });

  it("gives each stretch its own copy of the picture to cut from", () => {
    const two = redactionFilterGraph(
      [still, { ...still, id: "r3" }],
      10_000,
      1_920,
      1_080,
    );
    expect(two.filterComplex).toContain("[0:v]split=3[rbase][rsrc0][rsrc1]");
  });

  it("refuses to draw a blur when the frame size is not known", () => {
    expect(() => redactionFilterGraph([still], 10_000, 1_920)).toThrow(
      /frame size/i,
    );
    expect(() => redactionFilterGraph([still], 10_000, 0, 1_080)).toThrow(
      /frame size/i,
    );
  });

  it("builds the mosaic out of nothing the frame contains", () => {
    const { filterComplex } = redactionFilterGraph(
      [still],
      10_000,
      1_920,
      1_080,
      7,
    );

    expect(filterComplex).toMatch(/\[rc0\]scale=\d+:\d+:flags=neighbor,geq=/);
    expect(filterComplex).toContain(`,${MOSAIC_PALETTE.length})`);
    expect(filterComplex).toContain("*78.233+7)");
    expect(filterComplex).toMatch(/geq=[^;]+,scale=\d+:\d+:flags=neighbor/);
    expect(filterComplex).not.toContain("pixelize");
  });

  it("uses a different pattern for each box and each burn", () => {
    const two = [still, { ...still, id: "r9" }];
    const first = redactionFilterGraph(
      two,
      10_000,
      1_920,
      1_080,
      100,
    ).filterComplex;
    const again = redactionFilterGraph(
      two,
      10_000,
      1_920,
      1_080,
      500,
    ).filterComplex;
    expect(first).toContain("*78.233+100)");
    expect(first).toContain("*78.233+101)");
    expect(again).toContain("*78.233+500)");
    expect(again).not.toContain("*78.233+100)");
  });

  it("chains the styles together in one pass", () => {
    const { filterComplex, outputLabel } = redactionFilterGraph(
      [solid, { ...still, id: "r4" }],
      10_000,
      1_920,
      1_080,
    );
    expect(filterComplex).toContain("drawbox=");
    expect(filterComplex).toContain("geq=");
    expect(outputLabel).toBe("rv1");
  });

  it("quotes the expressions, so the commas inside them stay inside", () => {
    expect(
      redactionFilterGraph([solid], undefined, 1_920, 1_080).filterComplex,
    ).toMatch(/enable='between\(t,[\d.]+,[\d.]+\)'/);
  });

  it("only ever emits a colour it built itself", () => {
    const sneaky = { ...solid, color: "red@1:t=fill,crop=1:1" as string };
    const chain = redactionFilterGraph(
      parseRedactions([sneaky]),
      undefined,
      1_920,
      1_080,
    ).filterComplex;
    expect(chain).toContain(`color=0x${DEFAULT_REDACTION_COLOR.slice(1)}@1`);
    expect(chain).not.toContain("crop=1:1");
  });
});

describe("keeping a redaction reachable", () => {
  it("leaves one that already fits alone", () => {
    expect(clampRedactionToDuration(still, 10_000)).toBe(still);
  });

  it("drags one that has run off the end back inside, keeping its length", () => {
    const stranded = { ...still, startMs: 30_000, endMs: 33_000 };
    const fixed = clampRedactionToDuration(stranded, 10_000);
    expect(fixed).toMatchObject({ startMs: 7_000, endMs: 10_000 });
  });

  it("shortens one that is longer than the whole recording", () => {
    const huge = { ...still, startMs: 0, endMs: 90_000 };
    expect(clampRedactionToDuration(huge, 5_000)).toMatchObject({
      startMs: 0,
      endMs: 5_000,
    });
  });

  it("trims an overhanging end without moving the start", () => {
    const over = { ...still, startMs: 8_000, endMs: 12_000 };
    expect(clampRedactionToDuration(over, 10_000)).toMatchObject({
      startMs: 8_000,
      endMs: 10_000,
    });
  });

  it("does nothing when the duration is not known yet", () => {
    const stranded = { ...still, startMs: 30_000, endMs: 33_000 };
    expect(clampRedactionToDuration(stranded, 0)).toBe(stranded);
  });
});

describe("the burn's ffmpeg arguments", () => {
  const args = redactionBurnFfmpegArgs({
    inputPath: "/tmp/in.webm",
    outputPath: "/tmp/out.mp4",
    filterComplex: "[0:v]null[rv0]",
    outputLabel: "rv0",
  });
  const filter = args[args.indexOf("-filter_complex") + 1];

  it("caps a runaway frame rate without touching a normal one", () => {
    expect(filter).toContain(`fps=fps=min(${MAX_BURN_FPS}\\,source_fps)`);
    expect(args[args.indexOf("-map") + 1]).toBe("[rvout]");
  });

  it("caps after the boxes, so their timing is read off the original clock", () => {
    expect(filter.indexOf("[0:v]null[rv0]")).toBeLessThan(
      filter.indexOf("fps="),
    );
  });

  it("keeps the audio, and writes something that plays anywhere", () => {
    expect(args).toContain("0:a?");
    expect(args).toContain("+faststart");
    expect(args).toContain("libx264");
  });
});
