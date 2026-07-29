import { cleanup, render, waitFor } from "@testing-library/react";
// @vitest-environment happy-dom
import React from "react";
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
    ).toEqual({ scale: 1, x: 0, y: 0, fitted: false, verticalOverflow: 0 });
  });

  it("does not scale for vertical overflow but reports it for the LLM to fix", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 700,
        contentHeight: 500,
        viewportWidth: 740,
        viewportHeight: 380,
      }),
    ).toEqual({
      scale: 1,
      x: 0,
      y: 0,
      fitted: false,
      verticalOverflow: 120,
    });
  });

  it("scales horizontal overflow to the viewport width", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 1000,
        contentHeight: 300,
        viewportWidth: 740,
        viewportHeight: 380,
      }),
    ).toEqual({
      scale: 0.74,
      x: 0,
      y: 0,
      fitted: true,
      verticalOverflow: 0,
    });
  });

  it("uses the horizontal axis only — vertical overflow is ignored visually but reported", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 1000,
        contentHeight: 760,
        viewportWidth: 740,
        viewportHeight: 380,
      }),
    ).toEqual({
      scale: 0.74,
      x: 0,
      y: 0,
      fitted: true,
      verticalOverflow: 380,
    });
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
    ).toEqual({
      scale: 1,
      x: 20,
      y: 10,
      fitted: false,
      verticalOverflow: 0,
    });
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
          if (this.textContent?.includes("Horizontally fitted")) {
            return 1000;
          }
          if (this.textContent?.includes("Moved freeform object")) {
            return 786;
          }
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

  it("inserts an inner fit layer for raw fmd-slide HTML but no longer shrinks for vertical overflow", async () => {
    const slide: Slide = {
      id: "raw",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide" style="padding: 80px 110px;"><div>Dense content</div></div>',
    };

    const onOverflowChange = vi.fn();
    render(<SlideInner slide={slide} onOverflowChange={onOverflowChange} />);

    await waitFor(() => {
      const fitLayer = document.querySelector<HTMLElement>(
        "[data-fmd-autofit-content]",
      );
      expect(fitLayer).toBeTruthy();
      // Vertical overflow no longer triggers a uniform scale-down — the slide
      // renders at native size and the editor surfaces the overflow so the
      // agent can rewrite the HTML to fit instead.
      expect(fitLayer?.style.getPropertyValue("--fmd-fit-scale")).toBe("1");
      expect(fitLayer?.getAttribute("data-fmd-autofit-active")).toBeNull();
      expect(onOverflowChange).toHaveBeenCalledWith(
        expect.objectContaining({ verticalOverflow: 120 }),
      );
    });
  });

  it("reports vertical overflow for markdown slides too", async () => {
    const slide: Slide = {
      id: "markdown",
      layout: "content",
      notes: "",
      content: "## Dense slide\n\n" + Array(8).fill("- Bullet").join("\n"),
    };

    const onOverflowChange = vi.fn();
    render(<SlideInner slide={slide} onOverflowChange={onOverflowChange} />);

    await waitFor(() => {
      const fitRoot = document.querySelector<HTMLElement>(
        "[data-slide-autofit-root]",
      );
      expect(fitRoot?.style.getPropertyValue("--fmd-fit-scale")).toBe("1");
      expect(fitRoot?.getAttribute("data-fmd-autofit-active")).toBeNull();
      expect(onOverflowChange).toHaveBeenCalledWith(
        expect.objectContaining({ verticalOverflow: 120 }),
      );
    });
  });

  it("keeps the current fit transform stable while a raw slide text block is edited", async () => {
    const slide: Slide = {
      id: "raw-editing",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide" style="padding: 80px 110px;"><h2>Horizontally fitted title</h2></div>',
    };

    render(<SlideInner slide={slide} />);

    const fitLayer = await waitFor(() => {
      const layer = document.querySelector<HTMLElement>(
        "[data-fmd-autofit-content]",
      );
      expect(layer?.style.getPropertyValue("--fmd-fit-scale")).toBe("0.74");
      return layer;
    });

    const heading = fitLayer?.querySelector<HTMLElement>("h2");
    expect(heading).toBeTruthy();
    heading!.contentEditable = "true";

    // The contenteditable mutation schedules another fit pass. It must retain
    // the pre-edit transform rather than reset to 1 and visibly shift content.
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(fitLayer?.style.getPropertyValue("--fmd-fit-scale")).toBe("0.74");
  });

  it("does not fit the flow layer around a moved freeform object", async () => {
    const slide: Slide = {
      id: "raw-freeform",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide" style="padding: 80px 110px;"><h2>Flow title</h2><div class="fmd-freeform-object" data-slide-object-id="freeform-1" style="position: absolute; left: 46px; top: 174px; width: 740px;">Moved freeform object</div></div>',
    };

    render(<SlideInner slide={slide} />);

    await waitFor(() => {
      const fitLayer = document.querySelector<HTMLElement>(
        "[data-fmd-autofit-content]",
      );
      // The absolute object expands scrollWidth to 786px, but its independent
      // geometry must not shrink or shift the 740px normal-flow layout.
      expect(fitLayer?.scrollWidth).toBe(786);
      expect(fitLayer?.style.getPropertyValue("--fmd-fit-scale")).toBe("1");
      expect(fitLayer?.style.getPropertyValue("--fmd-fit-x")).toBe("0px");
      expect(fitLayer?.style.getPropertyValue("--fmd-fit-y")).toBe("0px");
      expect(fitLayer?.getAttribute("data-fmd-autofit-active")).toBeNull();
    });
  });
});
