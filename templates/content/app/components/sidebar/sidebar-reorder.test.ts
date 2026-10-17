// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  constrainedSidebarTransform,
  isSidebarDragReleaseClick,
  isPointerSidebarDrag,
  reorderedSidebarItemIds,
  sidebarReorderAnnouncement,
  SidebarReorderProvider,
  useSidebarReorderItem,
} from "./sidebar-reorder";

const items = [
  { id: "one", label: "One", parentId: null },
  { id: "child-a", label: "Child A", parentId: "one" },
  { id: "two", label: "Two", parentId: null },
  { id: "child-b", label: "Child B", parentId: "one" },
];

describe("sidebar keyboard activation", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it.each([
    ["link", "Enter", "Enter", false],
    ["link", " ", "Space", true],
    ["control", "Enter", "Enter", true],
    ["nested-control", "Enter", "Enter", false],
  ] as const)(
    "preserves %s activation with %s",
    async (origin, key, code, startsDrag) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      function Row() {
        const reorder = useSidebarReorderItem("one");
        return createElement(
          origin === "link" ? "a" : origin === "control" ? "button" : "div",
          {
            ...reorder.attributes,
            ...reorder.listeners,
            ref: reorder.setNodeRef,
            role: origin === "link" ? "link" : "button",
            href: origin === "link" ? "/page/one" : undefined,
            "data-dragging": String(reorder.isDragging),
          },
          origin === "nested-control"
            ? createElement("button", { type: "button" }, "Menu")
            : "One",
        );
      }
      try {
        await act(async () => {
          root.render(
            createElement(SidebarReorderProvider, {
              items: [items[0]],
              labels: {
                drag: (label: string) => `Drag ${label}`,
                moveUp: "Move up",
                moveDown: "Move down",
                moveTo: "Move to",
                moveToPosition: (position: number) => `Position ${position}`,
              },
              onReorder: vi.fn(),
              children: createElement(Row),
            }),
          );
        });
        const row = container.querySelector<HTMLElement>("[data-dragging]")!;
        const target =
          origin === "nested-control" ? row.querySelector("button")! : row;
        target.focus();
        const enter = new KeyboardEvent("keydown", {
          key,
          code,
          bubbles: true,
          cancelable: true,
        });
        await act(async () => {
          target.dispatchEvent(enter);
        });
        expect(enter.defaultPrevented).toBe(startsDrag);
        expect(row.dataset.dragging).toBe(String(startsDrag));
        if (startsDrag) {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
          await act(async () => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                code: "Escape",
                bubbles: true,
                cancelable: true,
              }),
            );
          });
          expect(row.dataset.dragging).toBe("false");
        }
      } finally {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      }
    },
  );
});

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
