import { describe, expect, it } from "vitest";

import { nextRowDragOverIndex, resolveRowDrop } from "./inspector-controls";

describe("nextRowDragOverIndex", () => {
  it("reports the hovered row when it differs from the dragged row", () => {
    expect(nextRowDragOverIndex(2, 0)).toBe(2);
    expect(nextRowDragOverIndex(0, 2)).toBe(0);
  });

  it("clears the indicator (null) when hovering back over the dragged row itself", () => {
    expect(nextRowDragOverIndex(1, 1)).toBeNull();
  });
});

describe("resolveRowDrop", () => {
  it("resolves a downward drag (from < to)", () => {
    expect(resolveRowDrop(0, 2, 4)).toEqual({ from: 0, to: 2 });
  });

  it("resolves an upward drag (from > to)", () => {
    expect(resolveRowDrop(3, 1, 4)).toEqual({ from: 3, to: 1 });
  });

  it("is a no-op when dropped on the same row it started from", () => {
    expect(resolveRowDrop(2, 2, 4)).toBeNull();
  });

  it("is a no-op when there is no active drag", () => {
    expect(resolveRowDrop(null, 2, 4)).toBeNull();
  });

  it("rejects a `to` that is out of range against the live count", () => {
    expect(resolveRowDrop(0, 5, 4)).toBeNull();
    expect(resolveRowDrop(0, -1, 4)).toBeNull();
  });

  it("rejects a stale `from` that is out of range against the live count", () => {
    expect(resolveRowDrop(4, 1, 3)).toBeNull();
  });
});
