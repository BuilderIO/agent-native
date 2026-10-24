// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { CanvasRulers, getRulerSelectionExtent } from "./CanvasRulers";

describe("getRulerSelectionExtent", () => {
  it("places the selection's edges on both rulers with canvas-unit labels", () => {
    const extent = getRulerSelectionExtent(
      { x: 100, y: 40, zoom: 50 },
      { left: 80, top: 400, right: 240, bottom: 520 },
      0,
    );
    expect(extent).toEqual({
      x: { start: 140, end: 220, startLabel: "80", endLabel: "240" },
      y: { start: 240, end: 300, startLabel: "400", endLabel: "520" },
    });
  });

  it("offsets by the canvas padding like the ticks do", () => {
    const extent = getRulerSelectionExtent(
      { x: 0, y: 0, zoom: 100 },
      { left: 0, top: 0, right: 10, bottom: 10 },
      24,
    );
    expect(extent.x.start).toBe(24);
    expect(extent.y.end).toBe(34);
  });
});

describe("CanvasRulers", () => {
  const render = async (
    props: Partial<Parameters<typeof CanvasRulers>[0]> = {},
  ) => {
    const onCanvasPointerDown = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <div onPointerDown={onCanvasPointerDown}>
          <CanvasRulers
            panX={0}
            panY={0}
            zoom={100}
            width={800}
            height={600}
            canvasPadding={0}
            {...props}
          />
        </div>,
      );
    });
    return {
      container,
      onCanvasPointerDown,
      unmount: async () => {
        await act(async () => root.unmount());
        container.remove();
      },
    };
  };

  it("keeps a press on a ruler from reaching the canvas, so it never starts a marquee", async () => {
    const view = await render();
    const bars = view.container.querySelectorAll("[data-canvas-ruler]");
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      bar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    }
    expect(view.onCanvasPointerDown).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("highlights the selection's extent with its start and end values", async () => {
    const view = await render({
      selectionBounds: { left: 80, top: 400, right: 240, bottom: 520 },
    });
    const labels = [
      ...view.container.querySelectorAll("[data-ruler-selection-label]"),
    ].map((label) => label.textContent);
    expect(labels).toEqual(["80", "240", "400", "520"]);
    expect(
      view.container.querySelectorAll("[data-ruler-selection-band]"),
    ).toHaveLength(2);
    await view.unmount();
  });
});
