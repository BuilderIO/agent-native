import { describe, expect, it } from "vitest";

import { projectGridPlacement } from "./project-layout";

describe("project grid layout", () => {
  it("places cells in a two-column layout when no placement is saved", () => {
    expect(projectGridPlacement({}, 2)).toEqual({
      gridX: 0,
      gridY: 2,
      gridWidth: 6,
      gridHeight: 2,
    });
  });

  it("keeps saved placements inside the twelve-column canvas", () => {
    expect(
      projectGridPlacement(
        { gridX: 100, gridY: -1, gridWidth: 20, gridHeight: 0 },
        0,
      ),
    ).toEqual({ gridX: 0, gridY: 0, gridWidth: 12, gridHeight: 1 });
    expect(projectGridPlacement({ gridWidth: 12 }, 1).gridX).toBe(0);
  });
  // oracle-change: The shared layout tests cover movement and resizing on the 120-unit grid.
});
