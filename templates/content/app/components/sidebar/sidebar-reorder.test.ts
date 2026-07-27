import { describe, expect, it } from "vitest";

import {
  reorderedSidebarItemIds,
  sidebarReorderAnnouncement,
} from "./sidebar-reorder";

const items = [
  { id: "one", label: "One", parentId: null },
  { id: "child-a", label: "Child A", parentId: "one" },
  { id: "two", label: "Two", parentId: null },
  { id: "child-b", label: "Child B", parentId: "one" },
];

describe("reorderedSidebarItemIds", () => {
  it("reorders references within one sibling set", () => {
    expect(reorderedSidebarItemIds(items, "one", "two")).toEqual([
      "two",
      "child-a",
      "one",
      "child-b",
    ]);
  });

  it("preserves non-sibling slots while changing sibling order", () => {
    expect(reorderedSidebarItemIds(items, "child-b", "child-a")).toEqual([
      "one",
      "child-b",
      "two",
      "child-a",
    ]);
  });

  it("rejects a cross-parent drop", () => {
    expect(reorderedSidebarItemIds(items, "child-a", "two")).toEqual(
      items.map((item) => item.id),
    );
  });

  it("announces labels and sibling positions instead of opaque ids", () => {
    const announcement = sidebarReorderAnnouncement(
      items,
      "child-b",
      "child-a",
      {
        drag: (label) => `Reordering ${label}`,
        moveUp: "Move up",
        moveDown: "Move down",
        moveTo: "Move to position",
        moveToPosition: (position) => `Position ${position}`,
      },
    );

    expect(announcement).toBe("Reordering Child B. Position 1.");
    expect(announcement).not.toContain("child-b");
  });
});
