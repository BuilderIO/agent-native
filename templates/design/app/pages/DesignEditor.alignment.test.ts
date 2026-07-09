/**
 * DesignEditor.alignment.test.ts
 *
 * Figma-parity selection alignment (Alt+A/D/W/S/H/V), distribute
 * (Ctrl+Alt+H/V), Tidy up (Ctrl+Alt+T), and Shift+A auto-layout inference —
 * pure-logic coverage for the exported helpers DesignEditor.tsx uses to
 * implement those features (see EditPanel's onAlignSelection contract and
 * useDesignHotkeys' onAlignSelection/onDistributeSelection/onTidyUp/
 * onAddAutoLayout bindings).
 */
import { describe, expect, it } from "vitest";

import {
  computeAlignedPositions,
  computeDistributedPositions,
  computeTidyPositions,
  inferAutoLayoutFromChildren,
  type AlignableRect,
} from "./design-editor/layout-operations";

describe("computeAlignedPositions", () => {
  const bounds = { x: 0, y: 0, width: 200, height: 100 };

  it("aligns left/right/top/bottom to the bounds edges", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 50, y: 20, width: 30, height: 10 },
    ];
    expect(computeAlignedPositions(rects, bounds, "left").get("a")).toEqual({
      x: 0,
      y: 20,
    });
    expect(computeAlignedPositions(rects, bounds, "right").get("a")).toEqual({
      x: 170,
      y: 20,
    });
    expect(computeAlignedPositions(rects, bounds, "top").get("a")).toEqual({
      x: 50,
      y: 0,
    });
    expect(computeAlignedPositions(rects, bounds, "bottom").get("a")).toEqual({
      x: 50,
      y: 90,
    });
  });

  it("centers along each axis", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 10 },
    ];
    expect(computeAlignedPositions(rects, bounds, "center-h").get("a")).toEqual(
      { x: 90, y: 0 },
    );
    expect(computeAlignedPositions(rects, bounds, "center-v").get("a")).toEqual(
      { x: 0, y: 45 },
    );
  });

  it("omits rects that are already aligned (no-op)", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 0, y: 20, width: 30, height: 10 },
    ];
    const result = computeAlignedPositions(rects, bounds, "left");
    expect(result.has("a")).toBe(false);
  });

  it("aligns each rect in a multi-selection independently to the same bounds", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 10, y: 0, width: 20, height: 10 },
      { id: "b", x: 150, y: 50, width: 40, height: 10 },
    ];
    const result = computeAlignedPositions(rects, bounds, "left");
    expect(result.get("a")).toEqual({ x: 0, y: 0 });
    expect(result.get("b")).toEqual({ x: 0, y: 50 });
  });
});

describe("computeDistributedPositions", () => {
  it("is a no-op with fewer than 3 rects", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", x: 100, y: 0, width: 10, height: 10 },
    ];
    expect(computeDistributedPositions(rects, "horizontal").size).toBe(0);
  });

  it("spaces the middle rects evenly, keeping first/last in place", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", x: 20, y: 0, width: 10, height: 10 },
      { id: "c", x: 100, y: 0, width: 10, height: 10 },
    ];
    const result = computeDistributedPositions(rects, "horizontal");
    // total span = 110 - 0 = 110; content = 30; 2 gaps => gap = 40
    // first ends at 10, so b starts at 10+40=50
    expect(result.get("b")).toEqual({ x: 50, y: 0 });
    expect(result.has("a")).toBe(false);
    expect(result.has("c")).toBe(false);
  });

  it("distributes vertically using y/height", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", x: 0, y: 30, width: 10, height: 10 },
      { id: "c", x: 0, y: 100, width: 10, height: 10 },
    ];
    const result = computeDistributedPositions(rects, "vertical");
    expect(result.get("b")).toEqual({ x: 0, y: 50 });
  });

  it("sorts unsorted input by position before distributing", () => {
    const rects: AlignableRect[] = [
      { id: "c", x: 100, y: 0, width: 10, height: 10 },
      { id: "a", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", x: 20, y: 0, width: 10, height: 10 },
    ];
    const result = computeDistributedPositions(rects, "horizontal");
    expect(result.get("b")).toEqual({ x: 50, y: 0 });
  });
});

describe("computeTidyPositions", () => {
  it("is a no-op with zero rects", () => {
    expect(computeTidyPositions([]).size).toBe(0);
  });

  it("arranges rects into a roughly-square grid anchored at the original top-left", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 500, y: 500, width: 100, height: 50 },
      { id: "b", x: 700, y: 600, width: 100, height: 50 },
      { id: "c", x: 900, y: 700, width: 100, height: 50 },
      { id: "d", x: 1100, y: 800, width: 100, height: 50 },
    ];
    const result = computeTidyPositions(rects);
    // 4 rects => 2 columns. The scattered originals should be pulled onto a
    // compact grid — the last rect (originally far from the origin) must
    // move onto row 1, well short of its original (1100, 800) position.
    expect(result.size).toBeGreaterThan(0);
    const dPos = result.get("d");
    expect(dPos).toBeDefined();
    expect(dPos!.x).toBeLessThan(1100);
    expect(dPos!.y).toBeLessThan(800);
  });

  it("leaves an already-tidy grid unchanged", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", x: 124, y: 0, width: 100, height: 100 },
    ];
    // 2 rects => 2 columns, 1 row. Gap between a/b is 24 (matches fallback).
    const result = computeTidyPositions(rects);
    expect(result.size).toBe(0);
  });
});

describe("inferAutoLayoutFromChildren", () => {
  it("infers row direction when children spread wider than tall", () => {
    const container = { x: 0, y: 0, width: 300, height: 100 };
    const children: AlignableRect[] = [
      { id: "a", x: 10, y: 10, width: 50, height: 50 },
      { id: "b", x: 80, y: 10, width: 50, height: 50 },
      { id: "c", x: 150, y: 10, width: 50, height: 50 },
    ];
    const result = inferAutoLayoutFromChildren(container, children);
    expect(result.direction).toBe("row");
    expect(result.gap).toBe(20);
    expect(result.padding).toBe(10);
  });

  it("infers column direction when children spread taller than wide", () => {
    const container = { x: 0, y: 0, width: 100, height: 300 };
    const children: AlignableRect[] = [
      { id: "a", x: 10, y: 10, width: 50, height: 50 },
      { id: "b", x: 10, y: 80, width: 50, height: 50 },
      { id: "c", x: 10, y: 150, width: 50, height: 50 },
    ];
    const result = inferAutoLayoutFromChildren(container, children);
    expect(result.direction).toBe("column");
    expect(result.gap).toBe(20);
    expect(result.padding).toBe(10);
  });

  it("falls back to gap 10 / padding 0 with no children", () => {
    const container = { x: 0, y: 0, width: 100, height: 100 };
    const result = inferAutoLayoutFromChildren(container, []);
    expect(result).toEqual({ direction: "row", gap: 10, padding: 0 });
  });

  it("uses the median gap when inter-child gaps vary", () => {
    const container = { x: 0, y: 0, width: 400, height: 100 };
    const children: AlignableRect[] = [
      { id: "a", x: 0, y: 0, width: 50, height: 50 },
      { id: "b", x: 60, y: 0, width: 50, height: 50 }, // gap 10
      { id: "c", x: 130, y: 0, width: 50, height: 50 }, // gap 20
      { id: "d", x: 220, y: 0, width: 50, height: 50 }, // gap 40
    ];
    const result = inferAutoLayoutFromChildren(container, children);
    // gaps: [10, 20, 40] -> median 20
    expect(result.gap).toBe(20);
  });
});
