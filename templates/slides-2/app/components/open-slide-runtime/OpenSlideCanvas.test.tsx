// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenSlideCanvas } from "./OpenSlideCanvas";

let containerSize = { width: 960, height: 540 };
const resizeObservers: TestResizeObserver[] = [];

class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  containerSize = { width: 960, height: 540 };
  resizeObservers.length = 0;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-open-slide-canvas-container")) {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width: containerSize.width,
          height: containerSize.height,
          right: containerSize.width,
          bottom: containerSize.height,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OpenSlideCanvas", () => {
  it("fits the canvas to its container and reapplies zoom after resize", () => {
    const onScaleChange = vi.fn();
    const { container, unmount } = render(
      <OpenSlideCanvas zoom={1.5} onScaleChange={onScaleChange}>
        <span>slide content</span>
      </OpenSlideCanvas>,
    );

    const canvas = container.querySelector(
      "[data-open-slide-canvas-container] > div",
    ) as HTMLDivElement;
    const stage = container.querySelector(
      "[data-open-slide-stage]",
    ) as HTMLDivElement;

    expect(canvas.style.width).toBe("1440px");
    expect(canvas.style.height).toBe("810px");
    expect(canvas.classList.contains("absolute")).toBe(true);
    expect(canvas.style.transform).toBe("translate(-50%, -50%)");
    expect(stage.style.width).toBe("1920px");
    expect(stage.style.height).toBe("1080px");
    expect(stage.style.transform).toBe("scale(0.75)");
    expect(onScaleChange).toHaveBeenLastCalledWith(0.75);
    expect(resizeObservers).toHaveLength(1);
    expect(resizeObservers[0]?.observe).toHaveBeenCalledTimes(1);

    containerSize = { width: 960, height: 360 };
    act(() => resizeObservers[0]?.trigger());

    expect(canvas.style.width).toBe("960px");
    expect(canvas.style.height).toBe("540px");
    expect(stage.style.transform).toBe("scale(0.5)");
    expect(onScaleChange).toHaveBeenLastCalledWith(0.5);

    unmount();
    expect(resizeObservers[0]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("uses an explicit scale without observing the container", () => {
    const onScaleChange = vi.fn();
    const { container } = render(
      <OpenSlideCanvas
        scale={0.25}
        zoom={2}
        center={false}
        flat
        onScaleChange={onScaleChange}
      >
        <span>slide content</span>
      </OpenSlideCanvas>,
    );

    const wrapper = container.querySelector(
      "[data-open-slide-canvas-container]",
    ) as HTMLDivElement;
    const canvas = wrapper.firstElementChild as HTMLDivElement;
    const stage = container.querySelector(
      "[data-open-slide-stage]",
    ) as HTMLDivElement;

    expect(resizeObservers).toHaveLength(0);
    expect(wrapper.classList.contains("overflow-hidden")).toBe(true);
    expect(canvas.classList.contains("absolute")).toBe(false);
    expect(canvas.classList.contains("rounded-md")).toBe(false);
    expect(canvas.classList.contains("shadow-2xl")).toBe(false);
    expect(canvas.style.width).toBe("480px");
    expect(canvas.style.height).toBe("270px");
    expect(stage.style.transform).toBe("scale(0.25)");
    expect(onScaleChange).toHaveBeenLastCalledWith(0.25);
  });

  it("blocks preview interaction only when requested", () => {
    const { container, rerender } = render(
      <OpenSlideCanvas scale={0.25}>
        <span>slide content</span>
      </OpenSlideCanvas>,
    );

    expect(
      container.querySelector("[data-open-slide-canvas-interaction-blocker]"),
    ).toBeNull();

    rerender(
      <OpenSlideCanvas scale={0.25} blockInteractions>
        <span>slide content</span>
      </OpenSlideCanvas>,
    );

    const blocker = container.querySelector(
      "[data-open-slide-canvas-interaction-blocker]",
    );
    expect(blocker).not.toBeNull();
    expect(blocker?.getAttribute("aria-hidden")).toBe("true");
    expect(blocker?.classList.contains("absolute")).toBe(true);
    expect(blocker?.classList.contains("inset-0")).toBe(true);
  });

  it("keeps a zero-size canvas hidden until the container can be measured", () => {
    containerSize = { width: 0, height: 0 };
    const onScaleChange = vi.fn();
    const { container } = render(
      <OpenSlideCanvas onScaleChange={onScaleChange}>
        <span>slide content</span>
      </OpenSlideCanvas>,
    );

    const canvas = container.querySelector(
      "[data-open-slide-canvas-container] > div",
    ) as HTMLDivElement;

    expect(canvas.style.visibility).toBe("hidden");
    expect(onScaleChange).not.toHaveBeenCalled();

    containerSize = { width: 960, height: 540 };
    act(() => resizeObservers[0]?.trigger());

    expect(canvas.style.visibility).toBe("");
    expect(canvas.style.width).toBe("960px");
    expect(canvas.style.height).toBe("540px");
    expect(onScaleChange).toHaveBeenLastCalledWith(0.5);
  });
});
