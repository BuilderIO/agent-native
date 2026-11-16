import { describe, expect, it } from "vitest";

import { frameFilename, framePositions, packBatches } from "./placement";

const layer = (
  origin: { x: number; y: number } | null,
  width: number | null = 100,
) => ({
  title: "L",
  width,
  height: 50,
  content: "",
  wrapsLooseNode: false,
  origin,
  sourceOffset: null,
});

describe("framePositions", () => {
  it("leaves placement to the server without a target spot", () => {
    expect(framePositions([layer(null)], null)).toEqual([null]);
  });

  it("keeps the frames' arrangement relative to the target spot", () => {
    expect(
      framePositions([layer({ x: 500, y: 700 }), layer({ x: 800, y: 650 })], {
        x: 10,
        y: 20,
      }),
    ).toEqual([
      { x: 10, y: 70 },
      { x: 310, y: 20 },
    ]);
  });

  it("places a frame with no origin past the ones that have one", () => {
    const positions = framePositions(
      [layer(null, 50), layer({ x: 500, y: 700 }, 300)],
      { x: 10, y: 20 },
    );
    expect(positions[1]).toEqual({ x: 10, y: 20 });
    // Past the known frame's right edge (10 + 300) plus the gap, never on it.
    expect(positions[0]).toEqual({ x: 406, y: 20 });
  });

  it("lays frames with no source position out left to right", () => {
    expect(
      framePositions([layer(null, 100), layer(null, 200)], { x: 0, y: 0 }),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 196, y: 0 },
    ]);
  });
});

describe("frameFilename", () => {
  it.each([
    [
      "Context=Fill, Tab=Custom, Paint=Solid, Mode=Hex",
      "context-fill-tab-custom-paint-solid-mode-hex",
    ],
    ["Components/Button", "components-button"],
    ["Hero / Desktop", "hero-desktop"],
    ["..\\escape", "escape"],
    ["  Spaced   out  ", "spaced-out"],
  ])("turns %j into a name the server accepts", (title, expected) => {
    expect(frameFilename(title)).toBe(expected);
    expect(expected).not.toMatch(/[\\/]|\.\./);
  });

  it("falls back when nothing Latin is left", () => {
    expect(frameFilename("日本語")).toBe("pasted-frame");
    expect(frameFilename("")).toBe("pasted-frame");
  });

  it("caps the length without leaving a trailing dash", () => {
    const name = frameFilename(`${"word ".repeat(40)}end`);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith("-")).toBe(false);
  });
});

describe("packBatches", () => {
  const size = (n: number) => n;

  it("keeps each item's original index across batches", () => {
    const batches = packBatches([5, 5, 5, 5], size, 10, 10);
    expect(batches.map((batch) => batch.map(({ index }) => index))).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("splits on the item limit and on the byte limit", () => {
    expect(packBatches([1, 1, 1], size, 2, 100).map((b) => b.length)).toEqual([
      2, 1,
    ]);
    expect(packBatches([6, 6, 6], size, 10, 10).map((b) => b.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it("sends an item over the byte limit on its own", () => {
    expect(packBatches([1, 50, 1], size, 10, 10).map((b) => b.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it("makes no batches for no items", () => {
    expect(packBatches([], size, 10, 10)).toEqual([]);
  });
});
