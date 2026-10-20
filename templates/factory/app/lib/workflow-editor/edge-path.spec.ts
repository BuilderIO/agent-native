import { describe, expect, it } from "vitest";

import { backEdgeGeometry, roundedPolyline } from "./edge-path.js";

describe("roundedPolyline", () => {
  it("starts and ends on the given points", () => {
    const path = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      10,
    );
    expect(path.startsWith("M 0 0")).toBe(true);
    expect(path.endsWith("L 100 100")).toBe(true);
    expect(path).toContain("Q 100 0");
  });

  it("shrinks the radius on a short segment instead of overshooting it", () => {
    const path = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      50,
    );
    expect(path).toContain("L 5 0");
  });

  it("is empty for fewer than two points", () => {
    expect(roundedPolyline([{ x: 1, y: 1 }], 10)).toBe("");
  });
});

describe("backEdgeGeometry", () => {
  it("detours below the lowest node it spans", () => {
    const { path, labelY } = backEdgeGeometry({
      source: { x: 800, y: 100 },
      target: { x: 200, y: 140 },
      bottom: 300,
    });
    expect(labelY).toBeGreaterThan(300);
    expect(path.startsWith("M 800 100")).toBe(true);
    expect(path.endsWith("L 200 140")).toBe(true);
  });

  it("centers its label on the bottom run", () => {
    const { labelX } = backEdgeGeometry({
      source: { x: 800, y: 100 },
      target: { x: 200, y: 100 },
      bottom: 150,
    });
    expect(labelX).toBeLessThan(800);
    expect(labelX).toBeGreaterThan(200);
  });

  it("puts a second loop on its own lane", () => {
    const base = {
      source: { x: 800, y: 100 },
      target: { x: 200, y: 100 },
      bottom: 150,
    };
    expect(backEdgeGeometry({ ...base, lane: 1 }).labelY).toBeGreaterThan(
      backEdgeGeometry(base).labelY,
    );
  });
});
