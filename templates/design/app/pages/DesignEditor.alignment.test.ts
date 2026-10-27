import { describe, expect, it } from "vitest";

import {
  alignSharedDelta,
  autoLayoutAlignmentPatch,
  computeAlignedPositions,
  computeDistributedPositions,
  computeTidyPositions,
  invertLinear,
  offsetStylePatch,
  planSharedMoves,
  type AlignableRect,
  type MeasuredAlignNode,
  type OffsetAxis,
} from "./design-editor/layout-operations";

describe("computeAlignedPositions", () => {
  const bounds = { x: 0, y: 0, width: 200, height: 100 };

  it("aligns left/right/top/bottom to the bounds edges", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 50, y: 20, width: 30, height: 10 },
    ];
    expect(computeAlignedPositions(rects, bounds, "left").get("a")).toEqual({
      x: 0,
    });
    expect(computeAlignedPositions(rects, bounds, "right").get("a")).toEqual({
      x: 170,
    });
    expect(computeAlignedPositions(rects, bounds, "top").get("a")).toEqual({
      y: 0,
    });
    expect(computeAlignedPositions(rects, bounds, "bottom").get("a")).toEqual({
      y: 90,
    });
  });

  it("centers along each axis", () => {
    const rects: AlignableRect[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 10 },
    ];
    expect(computeAlignedPositions(rects, bounds, "center-h").get("a")).toEqual(
      { x: 90 },
    );
    expect(computeAlignedPositions(rects, bounds, "center-v").get("a")).toEqual(
      { y: 45 },
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
    expect(result.get("a")).toEqual({ x: 0 });
    expect(result.get("b")).toEqual({ x: 0 });
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
    expect(result.get("b")).toEqual({ x: 50 });
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
    expect(result.get("b")).toEqual({ y: 50 });
  });

  it("sorts unsorted input by position before distributing", () => {
    const rects: AlignableRect[] = [
      { id: "c", x: 100, y: 0, width: 10, height: 10 },
      { id: "a", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", x: 20, y: 0, width: 10, height: 10 },
    ];
    const result = computeDistributedPositions(rects, "horizontal");
    expect(result.get("b")).toEqual({ x: 50 });
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
    const result = computeTidyPositions(rects);
    expect(result.size).toBe(0);
  });
});

const AUTO_AXIS: OffsetAxis = {
  start: "auto",
  end: "auto",
  size: "set",
  sizePx: 0,
};

function staticNode(
  id: string,
  rect: { x: number; y: number; width: number; height: number },
): MeasuredAlignNode {
  return {
    id,
    rect,
    parentBox: { x: 0, y: 0, width: 1000, height: 1000 },
    parentStableId: "frame",
    offsetToShared: { a: 1, b: 0, c: 0, d: 1 },
    layout: {
      kind: "offset",
      position: "static",
      left: 0,
      top: 0,
      x: AUTO_AXIS,
      y: AUTO_AXIS,
    },
    selectedAncestorId: null,
    movesNestedLayers: false,
  };
}

describe("alignSharedDelta", () => {
  it("moves only the aligned axis", () => {
    const bounds = { x: 0, y: 0, width: 200, height: 100 };
    const rect = { x: 50, y: 20, width: 30, height: 10 };
    expect(alignSharedDelta(rect, bounds, "right")).toEqual({ dx: 120, dy: 0 });
    expect(alignSharedDelta(rect, bounds, "center-v")).toEqual({
      dx: 0,
      dy: 25,
    });
  });
});

describe("invertLinear", () => {
  it("maps a screen delta back through a rotation", () => {
    const quarterTurn = { a: 0, b: 1, c: -1, d: 0 };
    const local = invertLinear(quarterTurn, { dx: 10, dy: 0 })!;
    expect(local.dx).toBeCloseTo(0);
    expect(local.dy).toBeCloseTo(-10);
  });

  it("refuses a singular map instead of inventing a delta", () => {
    expect(invertLinear({ a: 0, b: 0, c: 0, d: 0 }, { dx: 1, dy: 1 })).toBe(
      null,
    );
  });
});

describe("offsetStylePatch", () => {
  it("writes nothing for sub-pixel motion", () => {
    expect(
      offsetStylePatch(
        {
          kind: "offset",
          position: "static",
          left: 0,
          top: 0,
          x: AUTO_AXIS,
          y: AUTO_AXIS,
        },
        { dx: 0.4, dy: -0.2 },
      ),
    ).toEqual([]);
  });

  it("never pins the size of a relative layer, whose insets cannot size it", () => {
    expect(
      offsetStylePatch(
        {
          kind: "offset",
          position: "relative",
          left: 0,
          top: 0,
          x: { start: "auto", end: "set", size: "auto", sizePx: 90 },
          y: AUTO_AXIS,
        },
        { dx: 12, dy: 0 },
      ),
    ).toEqual([
      ["left", "12px"],
      ["right", "auto"],
    ]);
  });
});

describe("planSharedMoves", () => {
  it("distributes in-flow layers with relative offsets, leaving them in flow", () => {
    const rects = [
      staticNode("a", { x: 0, y: 0, width: 10, height: 10 }),
      staticNode("b", { x: 20, y: 30, width: 10, height: 10 }),
      staticNode("c", { x: 100, y: 60, width: 10, height: 10 }),
    ];
    const targets = computeDistributedPositions(
      rects.map((node) => ({ id: node.id, ...node.rect })),
      "horizontal",
    );
    const deltas = new Map(
      [...targets].map(([id, target]) => [
        id,
        { dx: target.x! - rects.find((node) => node.id === id)!.rect.x, dy: 0 },
      ]),
    );
    expect(planSharedMoves(rects, deltas)).toEqual({
      status: "planned",
      patches: new Map([
        [
          "b",
          [
            ["position", "relative"],
            ["left", "30px"],
          ],
        ],
      ]),
    });
  });

  it("blocks moving an auto layout child", () => {
    const child: MeasuredAlignNode = {
      ...staticNode("item", { x: 0, y: 0, width: 10, height: 10 }),
      layout: {
        kind: "auto-layout-child",
        fillsCrossAxis: false,
        parent: {
          display: "flex",
          flexDirection: "row",
          flexWrap: "nowrap",
          direction: "ltr",
          justifyContent: "normal",
          alignItems: "normal",
          justifyItems: "normal",
        },
      },
    };
    expect(
      planSharedMoves([child], new Map([["item", { dx: 5, dy: 0 }]])),
    ).toEqual({
      status: "blocked",
      blocker: "auto-layout-children",
      nodeId: "item",
    });
  });
});

describe("autoLayoutAlignmentPatch", () => {
  it("aligns grid items within their cells, like the Auto Layout matrix", () => {
    const grid = {
      display: "grid" as const,
      flexDirection: "row",
      flexWrap: "nowrap",
      direction: "ltr",
      justifyContent: "normal",
      alignItems: "normal",
      justifyItems: "normal",
    };
    expect(autoLayoutAlignmentPatch(grid, "right", false)).toEqual([
      ["justify-items", "flex-end"],
    ]);
    expect(autoLayoutAlignmentPatch(grid, "top", false)).toEqual([
      ["align-items", "flex-start"],
    ]);
  });

  it("flips the cross axis for wrap-reverse", () => {
    expect(
      autoLayoutAlignmentPatch(
        {
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap-reverse",
          direction: "ltr",
          justifyContent: "normal",
          alignItems: "normal",
          justifyItems: "normal",
        },
        "top",
        false,
      ),
    ).toEqual([["align-items", "flex-end"]]);
  });
});
