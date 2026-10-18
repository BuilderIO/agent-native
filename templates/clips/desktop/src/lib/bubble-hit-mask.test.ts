import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHitMask,
  createHitMaskSender,
  hitMaskCellSize,
  hitMaskContains,
  hitMaskGrid,
  sameHitMask,
} from "./bubble-hit-mask";

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

  it("limits an ellipse fallback to the inscribed circle", () => {
    const mask = buildHitMask({
      cols: 4,
      rows: 4,
      rgba: rgbaWithAlpha(4, 4, []),
      cellPx: 10,
      emptyFallback: { left: 0, top: 0, right: 40, bottom: 40 },
      emptyFallbackShape: "ellipse",
    });
    // The four corner cells sit outside the circle and stay click-through.
    expect(cellsOf(mask)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14]);
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

describe("hitMaskContains", () => {
  it("maps window fractions to packed cells like the native check", () => {
    // 3x2 grid with cells (2,0) and (0,1) set: bits 2 and 3.
    const mask = { cols: 3, rows: 2, bits: [0b0000_1100] };
    expect(hitMaskContains(mask, 0.9, 0.1)).toBe(true);
    expect(hitMaskContains(mask, 0.1, 0.9)).toBe(true);
    expect(hitMaskContains(mask, 0.1, 0.1)).toBe(false);
    expect(hitMaskContains(mask, 0.5, 0.9)).toBe(false);
    expect(hitMaskContains(mask, 1, 0.1)).toBe(false);
    expect(hitMaskContains(mask, -0.01, 0.1)).toBe(false);
  });
});

describe("hitMaskCellSize", () => {
  it("spreads the grid evenly so rects land where the lookup reads them", () => {
    // 100px is not a multiple of 6: 17 cells of 100/17px, not 6px.
    const grid = hitMaskGrid(100, 60);
    expect(grid).toEqual({ cols: 17, rows: 10 });
    const { cellWidth, cellHeight } = hitMaskCellSize(100, 60, grid);
    expect(cellWidth).toBeCloseTo(100 / 17);
    expect(cellHeight).toBe(6);
    // A control at the right edge (x 95-100) must be hit at fraction 0.97.
    const mask = buildHitMask({
      ...grid,
      rgba: null,
      rects: [{ left: 95, top: 0, right: 100, bottom: 6 }],
      cellWidth,
      cellHeight,
    });
    expect(hitMaskContains(mask, 0.97, 0.05)).toBe(true);
    expect(hitMaskContains(mask, 0.9, 0.05)).toBe(false);
  });
});

describe("createHitMaskSender", () => {
  const maskA = { cols: 1, rows: 1, bits: [1] };
  const maskB = { cols: 1, rows: 1, bits: [0] };

  function controlledApply() {
    const calls: {
      mask: unknown;
      resolve: () => void;
      reject: (e: unknown) => void;
    }[] = [];
    const apply = (mask: unknown) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ mask, resolve, reject });
      });
    return { calls, apply };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("waits for the call in flight and sends only the newest mask", async () => {
    const { calls, apply } = controlledApply();
    const sender = createHitMaskSender(apply);
    sender.send(maskA);
    sender.send(maskB);
    sender.send(null);
    expect(calls.map((c) => c.mask)).toEqual([maskA]);
    calls[0].resolve();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    // The clear goes out last, so a slow mask can never land after it.
    expect(calls[1].mask).toBeNull();
    expect(sender.current()).toBeNull();
  });

  it("skips a mask already applied and resends one that failed", async () => {
    const { calls, apply } = controlledApply();
    const onFailed = vi.fn();
    const sender = createHitMaskSender(apply, { onFailed });
    sender.send(maskA);
    calls[0].resolve();
    await settle();
    sender.send({ ...maskA });
    expect(calls).toHaveLength(1);
    sender.send(maskB);
    calls[1].reject(new Error("no"));
    await settle();
    expect(onFailed).toHaveBeenCalledTimes(1);
    sender.send(maskB);
    expect(calls).toHaveLength(3);
  });

  it("retries a rejected clear a bounded number of times", async () => {
    vi.useFakeTimers();
    const apply = vi.fn(() => Promise.reject(new Error("no")));
    const sender = createHitMaskSender(apply, {
      clearRetries: 2,
      clearRetryMs: 10,
    });
    sender.send(maskA);
    await vi.advanceTimersByTimeAsync(0);
    sender.send(null);
    await vi.advanceTimersByTimeAsync(100);
    // maskA, then the clear and its two retries.
    expect(apply).toHaveBeenCalledTimes(4);
  });
});
