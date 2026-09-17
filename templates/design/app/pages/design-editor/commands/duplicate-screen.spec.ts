import { describe, expect, it } from "vitest";

import { getDuplicateScreenGeometry } from "./duplicate-screen";

describe("getDuplicateScreenGeometry", () => {
  it("uses a moved source and skips occupied frames in the same row", () => {
    const source = { x: 1000, y: 240, width: 800, height: 600, z: 4 };
    const occupied = [
      { x: 1856, y: 240, width: 800, height: 600, z: 5 },
      { x: 400, y: 1200, width: 800, height: 600, z: 9 },
    ];

    expect(getDuplicateScreenGeometry(source, occupied)).toEqual({
      x: 2712,
      y: 240,
      width: 800,
      height: 600,
      z: 10,
    });
  });
});
