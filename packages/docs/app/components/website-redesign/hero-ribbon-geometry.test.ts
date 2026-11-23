import { describe, expect, it } from "vitest";

import {
  bendRadius,
  buildRibbonSheet,
  foldPoint,
} from "./hero-ribbon-geometry";

describe("hero ribbon geometry", () => {
  it("narrows the bend from 4 at the ends to 2 mid-length", () => {
    expect(bendRadius(0)).toBe(4);
    expect(bendRadius(1)).toBe(4);
    expect(bendRadius(0.5)).toBeCloseTo(2, 10);
  });

  it("lays both halves of the sheet over the same span, 2r apart", () => {
    const [leftX, leftZ] = foldPoint(-150, 0.5, 400);
    const [rightX, rightZ] = foldPoint(150, 0.5, 400);
    expect(leftX).toBeCloseTo(-50);
    expect(rightX).toBeCloseTo(-50);
    expect(leftZ - rightZ).toBeCloseTo(2 * bendRadius(0.5));
  });

  it("joins the halves with a continuous half-cylinder", () => {
    const [startX, startZ] = foldPoint(-16, 0.5, 400);
    const [endX, endZ] = foldPoint(15.999, 0.5, 400);
    expect(startX).toBeCloseTo(84);
    expect(startZ).toBeCloseTo(2);
    expect(endX).toBeCloseTo(84, 2);
    expect(endZ).toBeCloseTo(-2, 2);
  });

  it("builds a 129 x 257 vertex grid with two triangles per cell", () => {
    const sheet = buildRibbonSheet();
    expect(sheet.positions.length).toBe(129 * 257 * 3);
    expect(sheet.uvs.length).toBe(129 * 257 * 2);
    expect(sheet.indices.length).toBe(128 * 256 * 6);
    expect(sheet.indices.reduce((max, i) => Math.max(max, i), 0)).toBe(
      129 * 257 - 1,
    );
  });
});
