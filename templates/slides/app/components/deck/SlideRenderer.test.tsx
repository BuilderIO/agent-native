// @vitest-environment happy-dom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeSlideFitTransform,
  SlideInner,
} from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";

function rect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("computeSlideFitTransform", () => {
  it("leaves content alone when it fits", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 700,
        contentHeight: 300,
        viewportWidth: 740,
        viewportHeight: 380,
      }),
    ).toEqual({ scale: 1, x: 0, y: 0, fitted: false });
  });

  it("scales bottom overflow to the viewport height", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 700,
        contentHeight: 500,
        viewportWidth: 740,
        viewportHeight: 380,
      }),
    ).toEqual({ scale: 0.76, x: 0, y: 0, fitted: true });
  });

  it("scales horizontal overflow to the viewport width", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 1000,
        contentHeight: 300,
        viewportWidth: 740,
        viewportHeight: 380,
      }),
    ).toEqual({ scale: 0.74, x: 0, y: 0, fitted: true });
  });

  it("uses the limiting axis for two-axis overflow", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 1000,
        contentHeight: 760,
        viewportWidth: 740,
        viewportHeight: 380,
      }),
    ).toEqual({ scale: 0.65, x: 0, y: 0, fitted: true });
  });

  it("translates negative content back into view", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 700,
        contentHeight: 300,
        viewportWidth: 740,
        viewportHeight: 380,
        minX: -20,
        minY: -10,
      }),
    ).toEqual({ scale: 1, x: 20, y: 10, fitted: false });
  });
});

describe("SlideInner autofit", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      return window.setTimeout(() => cb(performance.now()), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      window.clearTimeout(id);
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });

    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        if (
          this.hasAttribute("data-fmd-autofit-content") ||
          this.hasAttribute("data-slide-autofit-root")
        ) {
          return 740;
        }
        return 960;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (
          this.hasAttribute("data-fmd-autofit-content") ||
          this.hasAttribute("data-slide-autofit-root")
        ) {
          return 380;
        }
        return 540;
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        if (
          this.hasAttribute("data-fmd-autofit-content") ||
          this.hasAttribute("data-slide-autofit-root")
        ) {
          return 740;
        }
        return this.clientWidth;
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (
          this.hasAttribute("data-fmd-autofit-content") ||
          this.hasAttribute("data-slide-autofit-root")
        ) {
          return 500;
        }
        return this.clientHeight;
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.hasAttribute("data-slide-canvas")) return rect(0, 0, 960, 540);
        if (
          this.hasAttribute("data-fmd-autofit-content") ||
          this.hasAttribute("data-slide-autofit-root")
        ) {
          return rect(110, 80, 740, 380);
        }
        return rect(110, 80, 740, 500);
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("inserts an inner fit layer for raw fmd-slide HTML and scales it", async () => {
    const slide: Slide = {
      id: "raw",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide" style="padding: 80px 110px;"><div>Dense content</div></div>',
    };

    render(<SlideInner slide={slide} />);

    await waitFor(() => {
      const fitLayer = document.querySelector<HTMLElement>(
        "[data-fmd-autofit-content]",
      );
      expect(fitLayer).toBeTruthy();
      expect(fitLayer?.style.getPropertyValue("--fmd-fit-scale")).toBe("0.76");
      expect(fitLayer?.getAttribute("data-fmd-autofit-active")).toBe("true");
    });
  });

  it("scales markdown slide content without needing raw HTML", async () => {
    const slide: Slide = {
      id: "markdown",
      layout: "content",
      notes: "",
      content: "## Dense slide\n\n" + Array(8).fill("- Bullet").join("\n"),
    };

    render(<SlideInner slide={slide} />);

    await waitFor(() => {
      const fitRoot = document.querySelector<HTMLElement>(
        "[data-slide-autofit-root]",
      );
      expect(fitRoot?.style.getPropertyValue("--fmd-fit-scale")).toBe("0.76");
      expect(fitRoot?.getAttribute("data-fmd-autofit-active")).toBe("true");
    });
  });
});
