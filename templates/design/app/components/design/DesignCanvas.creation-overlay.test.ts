import { describe, expect, it } from "vitest";

import { getScreenContentPointFromClient } from "./design-canvas/coordinate-transforms";
import { collapseDoubleClickPenAnchor } from "./design-canvas/creation";

describe("getScreenContentPointFromClient", () => {
  it("passes through 1:1 when the iframe is unscaled (rect matches content size)", () => {
    const point = getScreenContentPointFromClient(
      150,
      220,
      { left: 100, top: 50, width: 800, height: 600 },
      { width: 800, height: 600 },
    );
    expect(point).toEqual({ x: 50, y: 170 });
  });

  it("undoes a zoomed-out outer transform (rect smaller than content size)", () => {
    // A 50% zoom wrapper renders the iframe's rect at half its content size.
    const point = getScreenContentPointFromClient(
      100 + 200, // 200px into the rendered (zoomed) rect
      50 + 150,
      { left: 100, top: 50, width: 400, height: 300 },
      { width: 800, height: 600 },
    );
    // 200 rendered px at 50% scale = 400 content px.
    expect(point).toEqual({ x: 400, y: 300 });
  });

  it("undoes a zoomed-in outer transform (rect larger than content size)", () => {
    // A 200% zoom wrapper renders the iframe's rect at double its content size.
    const point = getScreenContentPointFromClient(
      10 + 100,
      20 + 60,
      { left: 10, top: 20, width: 1600, height: 1200 },
      { width: 800, height: 600 },
    );
    // 100 rendered px at 200% scale = 50 content px.
    expect(point).toEqual({ x: 50, y: 30 });
  });

  it("accounts for a non-zero rect origin", () => {
    const point = getScreenContentPointFromClient(
      325,
      420,
      { left: 300, top: 400, width: 800, height: 600 },
      { width: 800, height: 600 },
    );
    expect(point).toEqual({ x: 25, y: 20 });
  });

  it("falls back to 1:1 scale when content size is zero/unknown", () => {
    const point = getScreenContentPointFromClient(
      140,
      95,
      { left: 40, top: 45, width: 0, height: 0 },
      { width: 0, height: 0 },
    );
    expect(point).toEqual({ x: 100, y: 50 });
  });
});

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
