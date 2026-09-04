// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  constrainedSidebarTransform,
  isSidebarDragReleaseClick,
  isPointerSidebarDrag,
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

  it("clamps only the dragged row and always removes horizontal motion", () => {
    expect(
      constrainedSidebarTransform({ x: 80, y: -40 }, true, {
        minY: -20,
        maxY: 60,
      }),
    ).toMatchObject({ x: 0, y: -20 });
    expect(
      constrainedSidebarTransform({ x: 80, y: -40 }, false, {
        minY: 0,
        maxY: 60,
      }),
    ).toMatchObject({ x: 0, y: -40 });
  });

  it("scopes drag-release click suppression to the exact reordered row", () => {
    const row = document.createElement("a");
    row.dataset.sidebarReorderItemId = "two";
    const label = document.createElement("span");
    row.appendChild(label);

    const click = { button: 0, detail: 1, target: label };
    expect(isSidebarDragReleaseClick(click, "two")).toBe(true);
    expect(isSidebarDragReleaseClick(click, "one")).toBe(false);
    expect(
      isSidebarDragReleaseClick({ ...click, target: document.body }, "two"),
    ).toBe(false);
    expect(isSidebarDragReleaseClick({ ...click, detail: 0 }, "two")).toBe(
      false,
    );
    expect(isSidebarDragReleaseClick({ ...click, detail: 2 }, "two")).toBe(
      false,
    );
    expect(isSidebarDragReleaseClick({ ...click, button: 1 }, "two")).toBe(
      false,
    );
  });

  it("arms release suppression for pointer drags but not keyboard drags", () => {
    expect(
      isPointerSidebarDrag(new PointerEvent("pointerdown", { button: 0 })),
    ).toBe(true);
    expect(isPointerSidebarDrag(new KeyboardEvent("keydown"))).toBe(false);
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
