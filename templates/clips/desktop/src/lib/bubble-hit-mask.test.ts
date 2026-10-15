import { describe, expect, it } from "vitest";

import { buildHitMask, hitMaskGrid, sameHitMask } from "./bubble-hit-mask";

function rgbaWithAlpha(cols: number, rows: number, opaque: number[]) {
  const rgba = new Uint8ClampedArray(cols * rows * 4);
  for (const i of opaque) rgba[i * 4 + 3] = 255;
  return rgba;
}

function cellsOf(mask: { cols: number; rows: number; bits: number[] }) {
  const cells: number[] = [];
  for (let i = 0; i < mask.cols * mask.rows; i++) {
    if (mask.bits[i >> 3] & (1 << (i & 7))) cells.push(i);
  }
  return cells;
}

describe("hitMaskGrid", () => {
  it("covers the window with whole cells", () => {
    expect(hitMaskGrid(300, 349, 6)).toEqual({ cols: 50, rows: 59 });
    expect(hitMaskGrid(0, 0, 6)).toEqual({ cols: 1, rows: 1 });
  });
});

describe("buildHitMask", () => {
  it("is empty for a fully transparent cut-out", () => {
    const mask = buildHitMask({
      cols: 4,
      rows: 4,
      rgba: rgbaWithAlpha(4, 4, []),
    });
    expect(cellsOf(mask)).toEqual([]);
    expect(mask.bits).toHaveLength(2);
  });

  it("dilates opaque cells by one, clipped at the edges", () => {
    // 4x4 grid, opaque cell at (0,0) → (0..1, 0..1).
    const mask = buildHitMask({
      cols: 4,
      rows: 4,
      rgba: rgbaWithAlpha(4, 4, [0]),
    });
    expect(cellsOf(mask)).toEqual([0, 1, 4, 5]);
  });

  it("ignores alpha below the threshold", () => {
    const rgba = new Uint8ClampedArray(3 * 3 * 4);
    rgba[4 * 4 + 3] = 40;
    expect(cellsOf(buildHitMask({ cols: 3, rows: 3, rgba }))).toEqual([]);
    rgba[4 * 4 + 3] = 64;
    expect(cellsOf(buildHitMask({ cols: 3, rows: 3, rgba }))).toHaveLength(9);
  });

  it("adds control rectangles in CSS pixels", () => {
    const mask = buildHitMask({
      cols: 4,
      rows: 4,
      rgba: null,
      cellPx: 10,
      rects: [{ left: 25, top: 31, right: 39, bottom: 40 }],
    });
    expect(cellsOf(mask)).toEqual([14, 15]);
  });
});

describe("buildHitMask fallback", () => {
  const fallback = { left: 0, top: 0, right: 20, bottom: 10 };

  it("keeps the fallback area interactive when nobody is in frame", () => {
    const mask = buildHitMask({
      cols: 4,
      rows: 4,
      rgba: rgbaWithAlpha(4, 4, []),
      cellPx: 10,
      emptyFallback: fallback,
    });
    expect(cellsOf(mask)).toEqual([0, 1]);
  });

  it("drops the fallback once the person is visible", () => {
    const mask = buildHitMask({
      cols: 4,
      rows: 4,
      rgba: rgbaWithAlpha(4, 4, [15]),
      cellPx: 10,
      emptyFallback: fallback,
    });
    expect(cellsOf(mask)).toEqual([10, 11, 14, 15]);
  });
});

describe("sameHitMask", () => {
  it("compares shape and bits", () => {
    const a = buildHitMask({
      cols: 4,
      rows: 4,
      rgba: rgbaWithAlpha(4, 4, [5]),
    });
    const b = buildHitMask({
      cols: 4,
      rows: 4,
      rgba: rgbaWithAlpha(4, 4, [5]),
    });
    const c = buildHitMask({
      cols: 4,
      rows: 4,
      rgba: rgbaWithAlpha(4, 4, [10]),
    });
    expect(sameHitMask(a, b)).toBe(true);
    expect(sameHitMask(a, c)).toBe(false);
    expect(sameHitMask(a, null)).toBe(false);
    expect(sameHitMask(null, null)).toBe(true);
  });
});
