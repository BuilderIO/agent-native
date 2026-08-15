import { cleanup, render, waitFor } from "@testing-library/react";
// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeSlideFitTransform,
  prepareImportedFonts,
  resolveImportedFont,
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
    ).toEqual({
      scale: 1,
      x: 0,
      y: 0,
      fitted: false,
      verticalOverflow: 0,
      horizontalOverflow: 0,
    });
  });

  it("ignores a small layout-wrapper spill", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 700,
        contentHeight: 386,
        viewportWidth: 740,
        viewportHeight: 380,
      }).verticalOverflow,
    ).toBe(0);
  });

  it("ignores a small horizontal layout-wrapper spill", () => {
    expect(
      computeSlideFitTransform({
        contentWidth: 746,
        contentHeight: 300,
        viewportWidth: 740,
        viewportHeight: 380,
      }),
    ).toMatchObject({ scale: 1, fitted: false, horizontalOverflow: 0 });
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
      horizontalOverflow: 0,
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
      horizontalOverflow: 260,
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
      horizontalOverflow: 260,
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
      horizontalOverflow: 0,
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
      value: {
        ready: Promise.resolve(),
        addEventListener: () => {},
        removeEventListener: () => {},
      },
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
        if (this.textContent?.includes("Horizontally fitted")) {
          return rect(110, 80, 1000, 500);
        }
        if (this.classList.contains("fmd-freeform-object")) {
          return rect(156, 254, 740, 200);
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

  it("keeps design-system tokens on raw semantic slides", () => {
    const slide: Slide = {
      id: "semantic-raw",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide fmd-slide--title"><h1>Styled title</h1></div>',
    };

    render(
      <SlideInner
        slide={slide}
        designSystem={{
          colors: {
            primary: "#111111",
            secondary: "#222222",
            accent: "#ff00aa",
            background: "#030303",
            surface: "#121212",
            text: "#f5f5f5",
            textMuted: "#aaaaaa",
          },
          typography: {
            headingFont: "Inter",
            bodyFont: "Inter",
            headingWeight: "700",
            bodyWeight: "400",
            headingSizes: { h1: "46px", h2: "30px", h3: "24px" },
          },
          spacing: { slidePadding: "80px", elementGap: "24px" },
          borders: { radius: "12px", accentWidth: "1px" },
          slideDefaults: { background: "#030303", labelStyle: "uppercase" },
          logos: [],
        }}
      />,
    );

    const canvas = document.querySelector<HTMLElement>(
      '[data-slide-canvas="semantic-raw"]',
    );
    expect(canvas?.style.getPropertyValue("--ds-text")).toBe("#f5f5f5");
    expect(canvas?.querySelector(".fmd-slide--title")).toBeTruthy();
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

  it("reports overflow from both columns of a two-column slide", async () => {
    const slide: Slide = {
      id: "two-column",
      layout: "two-column",
      notes: "",
      content: "Left column\n\n---\n\nRight column",
    };

    const onOverflowChange = vi.fn();
    render(<SlideInner slide={slide} onOverflowChange={onOverflowChange} />);

    await waitFor(() => {
      expect(onOverflowChange.mock.calls.length).toBeGreaterThanOrEqual(2);
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

    const onOverflowChange = vi.fn();
    render(<SlideInner slide={slide} onOverflowChange={onOverflowChange} />);

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
      expect(onOverflowChange).toHaveBeenCalledWith(
        expect.objectContaining({ horizontalOverflow: 46 }),
      );
    });
  });

  it("defers measuring an off-screen slide until it scrolls into view", async () => {
    let notify: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
          notify = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    // Far below the viewport, the way most thumbnails in a long deck are.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => rect(0, 100_000, 740, 380),
    );

    const slide: Slide = {
      id: "raw-offscreen",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide" style="padding: 80px 110px;"><h2>Flow title</h2></div>',
    };
    render(<SlideInner slide={slide} />);

    // The fit layer is only ever created by a measure pass, so its absence
    // proves the expensive per-descendant measurement never ran.
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(document.querySelector("[data-fmd-autofit-content]")).toBeNull();

    notify?.([{ isIntersecting: true }]);

    await waitFor(() => {
      expect(
        document.querySelector("[data-fmd-autofit-content]"),
      ).not.toBeNull();
    });
  });
});

describe("imported deck webfonts", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve(),
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("serves a family the deck names", () => {
    expect(resolveImportedFont("Work Sans")).toEqual({
      family: "Work Sans",
      href: "https://fonts.googleapis.com/css2?family=Work+Sans:ital,wght@0,100..900;1,100..900&display=swap",
    });
  });

  it("asks a static-weight family for discrete weights, not a variable axis", () => {
    // The css2 endpoint 400s the whole request when a family has no such axis.
    expect(resolveImportedFont("Open Sans")?.href).toBe(
      "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap",
    );
  });

  it("maps a PPTX weight-suffixed typeface onto its base family", () => {
    expect(resolveImportedFont("Work Sans Medium")?.family).toBe("Work Sans");
    expect(resolveImportedFont("Open Sans SemiBold")?.family).toBe("Open Sans");
    expect(resolveImportedFont("Montserrat Light")?.family).toBe("Montserrat");
  });

  it("resolves families Google Fonts serves under another name", () => {
    expect(resolveImportedFont("Source Sans Pro")?.family).toBe(
      "Source Sans 3",
    );
    expect(resolveImportedFont("Bodoni")?.family).toBe("Bodoni Moda");
  });

  it("leaves a family it cannot serve alone instead of guessing", () => {
    expect(resolveImportedFont("Helvetica Neue")).toBeUndefined();
    expect(resolveImportedFont("Century Gothic")).toBeUndefined();
    expect(resolveImportedFont("")).toBeUndefined();
  });

  it("rewrites suffixed names in slide HTML and collects one href per family", () => {
    const { html, hrefs } = prepareImportedFonts(
      `<div class="fmd-slide" style="font-family: 'Work Sans', sans-serif;">` +
        `<span style="font-family:'Work Sans Medium', sans-serif;">a</span>` +
        `<span style="font-family:'Helvetica Neue', sans-serif;">b</span></div>`,
    );

    expect(html).toContain("font-family:'Work Sans', sans-serif");
    expect(html).not.toContain("Work Sans Medium");
    // Unservable families stay as authored so a locally installed copy still matches.
    expect(html).toContain("font-family:'Helvetica Neue', sans-serif");
    expect(hrefs).toEqual([
      "https://fonts.googleapis.com/css2?family=Work+Sans:ital,wght@0,100..900;1,100..900&display=swap",
    ]);
  });

  it("loads the stylesheet for a rendered imported slide", async () => {
    const slide: Slide = {
      id: "imported-fonts",
      layout: "blank",
      notes: "",
      content:
        `<div class="fmd-slide fmd-imported-pptx" style="font-family: 'Yanone Kaffeesatz', sans-serif;">Brand</div>`,
    };
    render(<SlideInner slide={slide} />);

    await waitFor(() => {
      expect(
        document.head.querySelector(
          'link[href*="Yanone+Kaffeesatz"][rel="stylesheet"]',
        ),
      ).not.toBeNull();
    });
  });
});
