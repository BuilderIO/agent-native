import { describe, expect, it } from "vitest";

import { collapseDoubleClickPenAnchor } from "./design-canvas/creation";

// oracle-change: removed getScreenContentPointFromClient cases that duplicate design-canvas/coordinate-transforms.test.ts, which owns that function (scaled, scrolled and zero-size inputs)

describe("collapseDoubleClickPenAnchor", () => {
  it("retains the final clicked anchor exactly once before committing", () => {
    const result = collapseDoubleClickPenAnchor({
      nodes: [
        { point: { x: 20, y: 30 } },
        { point: { x: 140, y: 90 } },
        { point: { x: 140, y: 90 }, handleOut: { x: 170, y: 110 } },
      ],
      closed: false,
    });

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((node) => node.point)).toEqual([
      { x: 20, y: 30 },
      { x: 140, y: 90 },
    ]);
    expect(result.nodes[1]?.handleOut).toEqual({ x: 170, y: 110 });
  });

  it("does not collapse distinct trailing anchors", () => {
    const path = {
      nodes: [{ point: { x: 20, y: 30 } }, { point: { x: 140, y: 90 } }],
      closed: false,
    };
    expect(collapseDoubleClickPenAnchor(path)).toBe(path);
  });
});
