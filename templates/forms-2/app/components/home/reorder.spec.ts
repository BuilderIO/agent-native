import { describe, expect, it } from "vitest";

import { moveItem, shiftItem } from "./reorder";

describe("reorder", () => {
  const ids = ["a", "b", "c"];

  it("shifts an item up and down", () => {
    expect(shiftItem(ids, "c", -1)).toEqual(["a", "c", "b"]);
    expect(shiftItem(ids, "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("returns the same list at the ends so callers can skip the save", () => {
    expect(shiftItem(ids, "a", -1)).toBe(ids);
    expect(shiftItem(ids, "c", 1)).toBe(ids);
  });

  it("moves to an index and ignores unknown ids", () => {
    expect(moveItem(ids, "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(ids, "x", 0)).toBe(ids);
  });
});
