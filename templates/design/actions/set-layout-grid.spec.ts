import { describe, expect, it } from "vitest";

import action from "./set-layout-grid.js";

describe("set-layout-grid schema", () => {
  const base = { designId: "design_1", screenId: "screen_1" };

  it("accepts a size, a visibility change, and a removal", () => {
    expect(action.schema.safeParse({ ...base, size: 8 }).success).toBe(true);
    expect(action.schema.safeParse({ ...base, visible: false }).success).toBe(
      true,
    );
    expect(action.schema.safeParse({ ...base, remove: true }).success).toBe(
      true,
    );
  });

  it("takes designId and screenId, since grids are per-screen", () => {
    expect(action.schema.safeParse({ screenId: "screen_1" }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ designId: "design_1" }).success).toBe(
      false,
    );
  });

  it("bounds size to the supported whole-pixel range", () => {
    expect(action.schema.safeParse({ ...base, size: 0 }).success).toBe(false);
    expect(action.schema.safeParse({ ...base, size: 1 }).success).toBe(true);
    expect(action.schema.safeParse({ ...base, size: 1000 }).success).toBe(true);
    expect(action.schema.safeParse({ ...base, size: 1001 }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ ...base, size: 8.5 }).success).toBe(false);
  });

  it("teaches the agent to author positions on the grid's multiples", () => {
    expect(action.tool.description).toMatch(/multiples of its size/);
  });
});
