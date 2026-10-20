// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RowDragHandle } from "./inspector-controls";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderHandle(dropIndicator: "before" | "after" | null) {
  act(() =>
    root.render(
      <RowDragHandle
        label="Reorder"
        dropIndicator={dropIndicator}
        draggable
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    ),
  );
  return {
    handle: container.querySelector<HTMLElement>('[aria-label="Reorder"]')!,
    line: container.querySelector<HTMLElement>(".h-px"),
  };
}

describe("RowDragHandle", () => {
  it("draws no drop line unless a drop is pending on its row", () => {
    expect(renderHandle(null).line).toBeNull();
  });

  it("draws the drop line beside the handle, not inside it, so fading the handle never hides it", () => {
    for (const side of ["before", "after"] as const) {
      const { handle, line } = renderHandle(side);
      expect(line).not.toBeNull();
      expect(handle.contains(line)).toBe(false);
      expect(line!.className).toContain(
        side === "before" ? "-top-[3px]" : "-bottom-[3px]",
      );
    }
  });

  it("starts and ends a drag from the handle itself", () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    act(() =>
      root.render(
        <RowDragHandle
          label="Reorder"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />,
      ),
    );
    const handle = container.querySelector<HTMLElement>(
      '[aria-label="Reorder"]',
    )!;
    expect(handle.getAttribute("draggable")).toBe("true");
    act(() => {
      handle.dispatchEvent(new Event("dragstart", { bubbles: true }));
      handle.dispatchEvent(new Event("dragend", { bubbles: true }));
    });
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onDragEnd).toHaveBeenCalledOnce();
  });
});
