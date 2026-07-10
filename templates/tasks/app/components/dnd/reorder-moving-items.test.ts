import { describe, expect, it } from "vitest";
import {
  getDragOverlayItem,
  reorderMovingItems,
} from "./reorder-moving-items.js";

const item = (id: string) => ({ id });

describe("reorderMovingItems", () => {
  it("moves a single item", () => {
    const items = [item("a"), item("b"), item("c")];
    const next = reorderMovingItems(items, "c", "a", new Set());
    expect(next.map((row) => row.id)).toEqual(["c", "a", "b"]);
  });

  it("moves the whole moving group when dropping on an unselected row", () => {
    const items = [item("a"), item("b"), item("c"), item("d")];
    const movingIds = new Set(["a", "b"]);
    const next = reorderMovingItems(items, "a", "d", movingIds);
    expect(next.map((row) => row.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("moves the whole moving group when dragging any grip in the block", () => {
    const items = [item("a"), item("b"), item("c"), item("d")];
    const movingIds = new Set(["a", "b"]);
    const next = reorderMovingItems(items, "b", "d", movingIds);
    expect(next.map((row) => row.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("moves the moving group before an unselected row above", () => {
    const items = [item("c"), item("a"), item("b"), item("d")];
    const movingIds = new Set(["a", "b"]);
    const next = reorderMovingItems(items, "b", "c", movingIds);
    expect(next.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps moving items in their list order after moving the block", () => {
    const items = [
      item("a"),
      item("b"),
      item("c"),
      item("d"),
      item("e"),
      item("f"),
    ];
    const movingIds = new Set(["b", "c", "d"]);
    const next = reorderMovingItems(items, "c", "f", movingIds);
    expect(next.map((row) => row.id)).toEqual(["a", "e", "f", "b", "c", "d"]);
  });

  it("places the block after a row when dragging down with the bottom grip", () => {
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    const movingIds = new Set(["b", "c"]);
    const next = reorderMovingItems(items, "c", "e", movingIds);
    expect(next.map((row) => row.id)).toEqual(["a", "d", "e", "b", "c"]);
  });

  it("places the block below a row when dragging up onto it", () => {
    const items = [item("2"), item("test"), item("4"), item("3")];
    const movingIds = new Set(["4", "3"]);
    const next = reorderMovingItems(items, "3", "2", movingIds);
    expect(next.map((row) => row.id)).toEqual(["2", "4", "3", "test"]);
  });

  it("places the block after a row when dragging down below the block", () => {
    const items = [item("3"), item("4"), item("1"), item("2")];
    const movingIds = new Set(["3", "4"]);
    const next = reorderMovingItems(items, "4", "2", movingIds);
    expect(next.map((row) => row.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("moves a leading block down when dropping on the last row", () => {
    const items = [item("b"), item("c"), item("d"), item("a"), item("e")];
    const movingIds = new Set(["b", "c", "d"]);
    const next = reorderMovingItems(items, "d", "e", movingIds);
    expect(next.map((row) => row.id)).toEqual(["a", "e", "b", "c", "d"]);
  });

  it("moves a trailing block to the top when dragging up onto the first row", () => {
    const items = [
      item("a"),
      item("b"),
      item("c"),
      item("d"),
      item("e"),
      item("f"),
    ];
    const movingIds = new Set(["d", "e", "f"]);
    const next = reorderMovingItems(items, "f", "a", movingIds);
    expect(next.map((row) => row.id)).toEqual(["d", "e", "f", "a", "b", "c"]);
  });

  it("moves a trailing block to the top when dragging with the top moving grip", () => {
    const items = [
      item("a"),
      item("b"),
      item("c"),
      item("d"),
      item("e"),
      item("f"),
    ];
    const movingIds = new Set(["d", "e", "f"]);
    const next = reorderMovingItems(items, "d", "a", movingIds);
    expect(next.map((row) => row.id)).toEqual(["d", "e", "f", "a", "b", "c"]);
  });

  it("does not change order when dropping on another moving row in the block", () => {
    const items = [item("a"), item("b"), item("c"), item("d")];
    const movingIds = new Set(["b", "c"]);
    const next = reorderMovingItems(items, "b", "c", movingIds);
    expect(next.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("getDragOverlayItem", () => {
  it("shows the topmost moving item during block drag", () => {
    const items = [item("a"), item("b"), item("c"), item("d")];
    const movingIds = new Set(["b", "c"]);
    expect(getDragOverlayItem(items, "c", movingIds)?.id).toBe("b");
  });

  it("shows the grabbed item for single-row drag", () => {
    const items = [item("a"), item("b"), item("c")];
    expect(getDragOverlayItem(items, "c", new Set())?.id).toBe("c");
  });
});
