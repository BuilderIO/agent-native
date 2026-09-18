// @vitest-environment happy-dom

import type { PlanContent } from "@shared/plan-content";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasArea } from "./CanvasArea";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("./wireframe/Wireframe", () => ({
  Wireframe: () => <div data-testid="mock-wireframe" />,
}));

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function dispatchPointer(
  element: HTMLElement,
  type: string,
  input: { pointerId: number; clientX: number; clientY: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: input.clientX },
    clientY: { value: input.clientY },
    pointerId: { value: input.pointerId },
  });
  act(() => element.dispatchEvent(event));
}

function dispatchWheel(
  element: HTMLElement,
  input: {
    deltaY: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
  },
) {
  const event = new Event("wheel", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: 200 },
    clientY: { value: 100 },
    ctrlKey: { value: input.ctrlKey ?? false },
    deltaMode: { value: 0 },
    deltaX: { value: 0 },
    deltaY: { value: input.deltaY },
    metaKey: { value: input.metaKey ?? false },
    shiftKey: { value: false },
  });
  act(() => element.dispatchEvent(event));
}

function renderCanvas() {
  act(() => {
    root.render(
      <CanvasArea
        canvas={
          {
            mode: "design",
            viewport: { zoom: 1, pan: { x: 0, y: 0 } },
            frames: [
              {
                id: "frame-1",
                surface: "desktop",
                wireframe: { surface: "desktop", html: "<p>Frame</p>" },
              },
            ],
          } as unknown as NonNullable<PlanContent["canvas"]>
        }
        blockLookup={new Map()}
      />,
    );
  });

  const viewport = container.querySelector<HTMLElement>(
    "[data-plan-canvas-viewport]",
  );
  const world = container.querySelector<HTMLElement>(
    "[data-plan-canvas-world]",
  );
  expect(viewport).toBeTruthy();
  expect(world).toBeTruthy();
  Object.defineProperty(viewport, "clientWidth", { value: 390 });
  Object.defineProperty(viewport, "clientHeight", { value: 844 });
  viewport!.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 390,
      height: 844,
      right: 390,
      bottom: 844,
    }) as DOMRect;
  viewport!.setPointerCapture = () => {};
  viewport!.releasePointerCapture = () => {};

  return { viewport: viewport!, world: world! };
}

describe("CanvasArea touch gestures", () => {
  it("turns two touch pointers into cursor-anchored zoom", () => {
    const { viewport, world } = renderCanvas();

    dispatchPointer(viewport!, "pointerdown", {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    dispatchPointer(viewport!, "pointerdown", {
      pointerId: 2,
      clientX: 300,
      clientY: 100,
    });
    dispatchPointer(viewport!, "pointermove", {
      pointerId: 1,
      clientX: 50,
      clientY: 100,
    });
    dispatchPointer(viewport!, "pointermove", {
      pointerId: 2,
      clientX: 350,
      clientY: 100,
    });

    expect(world?.style.transform).toContain("scale(1.5)");
  });

  it("matches Figma's Command/Ctrl plus wheel zoom convention", () => {
    const { viewport, world } = renderCanvas();

    dispatchWheel(viewport, { deltaY: -20, ctrlKey: true });

    expect(world.style.transform).toMatch(/scale\(1\.2214/);
    expect(
      container.querySelector(".plan-canvas-zoom")?.getAttribute("title"),
    ).toBe("raw.canvas.zoomHint");
  });
});
