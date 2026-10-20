// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PinnedWebviewFrame } from "./PinnedWebviewFrame.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  NoopResizeObserver;

function slotAt(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  const slot = document.createElement("div");
  slot.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
    }) as DOMRect;
  document.body.appendChild(slot);
  return slot;
}

describe("PinnedWebviewFrame", () => {
  let root: Root | undefined;
  const container = document.createElement("div");
  document.body.appendChild(container);

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
  });

  const render = (slot: HTMLElement | null) =>
    act(() => {
      root ??= createRoot(container);
      root.render(
        <PinnedWebviewFrame slot={slot}>
          <span data-guest />
        </PinnedWebviewFrame>,
      );
    });
  const frame = () => container.firstElementChild as HTMLDivElement;

  it("keeps the guest mounted but hidden until a slot shows it", () => {
    render(null);
    expect(container.querySelector("[data-guest]")).not.toBeNull();
    expect(frame().style.visibility).toBe("hidden");
    expect(frame().style.pointerEvents).toBe("none");
  });

  it("lays the guest over a visible slot and hides it again without unmounting", () => {
    const slot = slotAt({ left: 56, top: 0, width: 1224, height: 800 });
    render(slot);
    expect(frame().style.visibility).toBe("visible");
    expect(frame().style.pointerEvents).toBe("auto");
    expect([
      frame().style.left,
      frame().style.top,
      frame().style.width,
      frame().style.height,
    ]).toEqual(["56px", "0px", "1224px", "800px"]);

    const guest = container.querySelector("[data-guest]");
    render(null);
    expect(frame().style.visibility).toBe("hidden");
    expect(container.querySelector("[data-guest]")).toBe(guest);
  });

  it("stays hidden over a zero-size slot such as an inactive tab", () => {
    render(slotAt({ left: 0, top: 0, width: 0, height: 0 }));
    expect(frame().style.visibility).toBe("hidden");
  });
});
