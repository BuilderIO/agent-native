import { cleanup, render, waitFor } from "@testing-library/react";
// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SlideRenderer, {
  computeSlideFitTransform,
  getRenderedSlideSource,
  isRawHtmlSlide,
  prepareImportedFonts,
  resolveImportedFont,
  renderRawSlideHtml,
  SLIDE_CONTENT_REPLACE_EVENT,
  slideDeclaresTextColor,
  SlideInner,
} from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import {
  captureSlideImageUploadProvenance,
  registerSlideImageUploadProvenance,
} from "@/lib/slide-image-replacement";
import { mergeRenderedEdits, SOURCE_STAMP_ATTR } from "@/lib/slide-source-map";

vi.mock("./MermaidRenderer", () => ({
  MermaidRenderer: () => <div data-mermaid-diagram="true" />,
}));

vi.mock("./ExcalidrawSlide", () => ({
  ExcalidrawThumbnail: () => <div data-excalidraw-thumbnail="true" />,
  parseExcalidrawData: (json?: string) => {
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  },
}));

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

function renderUploadSnapshot(root: HTMLElement, content: string): string {
  const source = getRenderedSlideSource(root)!;
  const scopeId = root.getAttribute("data-slide-content-scope")!;
  return renderRawSlideHtml(content, {
    scopeSelector: `[data-slide-content-scope="${scopeId}"]`,
    stampNonce: source.nonce,
  }).html;
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

describe("isRawHtmlSlide", () => {
  it("treats any stored markup as raw HTML, whatever its layout", () => {
    expect(
      isRawHtmlSlide({
        content: '<div class="fmd-slide fmd-imported-pptx"><div>Hi</div></div>',
        layout: "content",
      }),
    ).toBe(true);
    expect(
      isRawHtmlSlide({ content: "# Title\n\n- one", layout: "content" }),
    ).toBe(false);
    expect(
      isRawHtmlSlide({
        content: '<img data-markdown-image src="https://cdn.test/a.png">',
        layout: "content",
      }),
    ).toBe(false);
  });
});

describe("SlideInner source stamps", () => {
  afterEach(() => cleanup());

  const content =
    '<div class="fmd-slide"><img src="blob:preview" data-slide-object-id="image-1" style="position:absolute;left:40px;top:24px"><p>Caption</p></div>';

  it("stamps and registers only the editable canvas", () => {
    const slide = { id: "slide-a", content, layout: "blank" } as Slide;
    const { unmount } = render(<SlideInner slide={slide} />);
    const plain = document.querySelector<HTMLElement>(".slide-content")!;
    expect(plain.innerHTML).not.toContain(SOURCE_STAMP_ATTR);
    expect(getRenderedSlideSource(plain)).toBeUndefined();
    unmount();

    render(<SlideInner slide={slide} stampSource />);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    expect(root.querySelector("p")!.getAttribute(SOURCE_STAMP_ATTR)).toMatch(
      /\.slide-a:2$/,
    );
    expect(getRenderedSlideSource(root)?.stored).toBe(content);
  });

  it("re-registers the new source after an in-place image swap", async () => {
    const slide = { id: "slide-b", content, layout: "blank" } as Slide;
    const { rerender } = render(<SlideInner slide={slide} stampSource />);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    const image = root.querySelector("img")!;
    const uploaded = content.replace("blob:preview", "https://cdn.test/a.png");
    rerender(
      <SlideInner slide={{ ...slide, content: uploaded }} stampSource />,
    );
    await waitFor(() =>
      expect(image.getAttribute("src")).toBe("https://cdn.test/a.png"),
    );
    expect(root.querySelector("img")).toBe(image);
    const source = getRenderedSlideSource(root)!;
    expect(source.stored).toBe(uploaded);
    image.style.left = "80px";
    expect(
      mergeRenderedEdits({
        ...source,
        live: root.cloneNode(true) as Element,
      }).html,
    ).toBe(
      uploaded.replace(
        "position:absolute;left:40px;top:24px",
        "position:absolute; top:24px; left: 80px",
      ),
    );
  });
  it("never re-renders a root whose text is being edited", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const slide = { id: "slide-c", content, layout: "blank" } as Slide;
    const { rerender } = render(<SlideInner slide={slide} stampSource />);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    const edited = root.querySelector("p")!;
    edited.setAttribute("contenteditable", "true");
    edited.textContent = "Caption typed";
    rerender(
      <SlideInner
        slide={{ ...slide, content: content.replace("Caption", "Agent") }}
        stampSource
      />,
    );
    expect(root.querySelector("p")).toBe(edited);
    expect(edited.textContent).toBe("Caption typed");
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("applies an upload's image swap under an open edit and merges the edit onto it", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const slide = { id: "slide-f", content, layout: "blank" } as Slide;
    const { rerender } = render(<SlideInner slide={slide} stampSource />);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    const image = root.querySelector("img")!;
    const edited = root.querySelector("p")!;
    edited.setAttribute("contenteditable", "true");
    edited.textContent = "Caption typed";
    const uploaded = content.replace("blob:preview", "https://cdn.test/a.png");
    const provenance = captureSlideImageUploadProvenance(
      root,
      renderUploadSnapshot(root, content),
    )!;
    registerSlideImageUploadProvenance(slide.id, uploaded, provenance);
    rerender(
      <SlideInner slide={{ ...slide, content: uploaded }} stampSource />,
    );
    await waitFor(() =>
      expect(image.getAttribute("src")).toBe("https://cdn.test/a.png"),
    );
    expect(root.querySelector("p")).toBe(edited);
    expect(errors).not.toHaveBeenCalled();
    const source = getRenderedSlideSource(root)!;
    expect(source.stored).toBe(uploaded);
    expect(
      mergeRenderedEdits({ ...source, live: root.cloneNode(true) as Element })
        .html,
    ).toBe(uploaded.replace("Caption", "Caption typed"));

    const remote = uploaded.replace(
      "<p>Caption</p>",
      "<h2>Agent</h2><p>Caption</p>",
    );
    const commit = vi.fn((event: Event) => {
      expect((event as CustomEvent).detail).toEqual({ content: remote });
      edited.removeAttribute("contenteditable");
    });
    document.addEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    rerender(<SlideInner slide={{ ...slide, content: remote }} stampSource />);
    document.removeEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(getRenderedSlideSource(root)?.stored).toBe(remote);
    errors.mockRestore();
  });

  it("commits an open edit with the incoming source, then applies another write to the same slide", () => {
    const titled = content.replace("<p>", "<h2>Title</h2><p>");
    const slide = { id: "slide-g", content: titled, layout: "blank" } as Slide;
    const { rerender } = render(<SlideInner slide={slide} stampSource />);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    const edited = root.querySelector("p")!;
    edited.setAttribute("contenteditable", "true");
    const remote = titled.replace("Title", "Agent title");
    const commit = vi.fn((event: Event) => {
      expect((event as CustomEvent).detail).toEqual({ content: remote });
      edited.removeAttribute("contenteditable");
    });
    document.addEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    rerender(<SlideInner slide={{ ...slide, content: remote }} stampSource />);
    document.removeEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(root.querySelector("h2")!.textContent).toBe("Agent title");
    expect(getRenderedSlideSource(root)?.stored).toBe(remote);
  });

  it("commits instead of patching images when more than the images changed", () => {
    const titled = content.replace("<p>", "<h2>Title</h2><p>");
    const slide = { id: "slide-h", content: titled, layout: "blank" } as Slide;
    const { rerender } = render(<SlideInner slide={slide} stampSource />);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    const edited = root.querySelector("p")!;
    edited.setAttribute("contenteditable", "true");
    const mixed = titled
      .replace("blob:preview", "https://cdn.test/a.png")
      .replace("Title", "Agent title");
    const commit = vi.fn(() => edited.removeAttribute("contenteditable"));
    document.addEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    rerender(<SlideInner slide={{ ...slide, content: mixed }} stampSource />);
    document.removeEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(root.querySelector("h2")!.textContent).toBe("Agent title");
    expect(root.querySelector("img")!.getAttribute("src")).toBe(
      "https://cdn.test/a.png",
    );
    expect(getRenderedSlideSource(root)?.stored).toBe(mixed);
  });

  it("commits a mixed upload when its edited-node snapshot no longer matches", () => {
    const slide = { id: "slide-j", content, layout: "blank" } as Slide;
    const { rerender } = render(<SlideInner slide={slide} stampSource />);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    const edited = root.querySelector("p")!;
    edited.setAttribute("contenteditable", "true");
    edited.textContent = "Caption typed";
    const draft = content.replace("Caption", "Caption ty");
    const provenance = captureSlideImageUploadProvenance(
      root,
      renderUploadSnapshot(root, draft),
    )!;
    const remote = content
      .replace("blob:preview", "https://cdn.test/a.png")
      .replace("Caption", "Agent caption");
    registerSlideImageUploadProvenance(slide.id, remote, provenance);
    const commit = vi.fn((event: Event) => {
      expect((event as CustomEvent).detail).toEqual({ content: remote });
      edited.removeAttribute("contenteditable");
    });
    document.addEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    rerender(<SlideInner slide={{ ...slide, content: remote }} stampSource />);
    document.removeEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(root.querySelector("p")!.textContent).toBe("Agent caption");
    expect(getRenderedSlideSource(root)?.stored).toBe(remote);
  });

  it("keeps an edit open when an upload carries its captured edited-node snapshot", async () => {
    const slide = { id: "slide-i", content, layout: "blank" } as Slide;
    const { rerender } = render(<SlideInner slide={slide} stampSource />);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    const image = root.querySelector("img")!;
    const edited = root.querySelector("p")!;
    edited.setAttribute("contenteditable", "true");
    const draft = content.replace("Caption", "Caption ty");
    edited.textContent = "Caption typed";
    const uploaded = draft.replace("blob:preview", "https://cdn.test/a.png");
    const provenance = captureSlideImageUploadProvenance(
      root,
      renderUploadSnapshot(root, draft),
    )!;
    const commit = vi.fn();
    document.addEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    registerSlideImageUploadProvenance(slide.id, uploaded, provenance);
    rerender(
      <SlideInner
        slide={{
          ...slide,
          content: uploaded,
        }}
        stampSource
      />,
    );
    document.removeEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    await waitFor(() =>
      expect(image.getAttribute("src")).toBe("https://cdn.test/a.png"),
    );
    expect(commit).not.toHaveBeenCalled();
    expect(root.querySelector("p")).toBe(edited);
    expect(edited.textContent).toBe("Caption typed");
  });

  it("asks the editor to commit before another slide replaces an edit", () => {
    const slide = { id: "slide-d", content, layout: "blank" } as Slide;
    const { rerender } = render(<SlideInner slide={slide} stampSource />);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    const edited = root.querySelector("p")!;
    edited.setAttribute("contenteditable", "true");
    const commit = vi.fn(() => edited.removeAttribute("contenteditable"));
    document.addEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    rerender(
      <SlideInner
        slide={
          { id: "slide-e", content: "<p>Next</p>", layout: "blank" } as Slide
        }
        stampSource
      />,
    );
    document.removeEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("Next");
  });
});

describe("SlideInner autofit", () => {
  it("centers full-size slides inside their viewport while scaling to contain", () => {
    render(
      <SlideRenderer
        slide={{
          id: "presentation-slide",
          layout: "blank",
          notes: "",
          content: '<div class="fmd-slide"><h1>Centered</h1></div>',
        }}
        aspectRatio="16:9"
        thumbnail={false}
      />,
    );

    const viewport = document.querySelector<HTMLElement>(
      '[data-slide-canvas="presentation-slide"]',
    )?.parentElement?.parentElement;
    expect(viewport?.classList.contains("flex")).toBe(true);
    expect(viewport?.classList.contains("items-center")).toBe(true);
    expect(viewport?.classList.contains("justify-center")).toBe(true);
    expect(viewport?.firstElementChild?.classList.contains("shrink-0")).toBe(
      true,
    );
    expect(
      viewport?.firstElementChild?.classList.contains("origin-center"),
    ).toBe(true);
  });

  it("updates an uploaded image source without replacing its live node", async () => {
    const previewContent =
      '<div class="fmd-slide"><img src="blob:preview" data-slide-object-id="image-1" style="position:absolute;left:40px;top:24px;width:320px;height:180px;"></div>';
    const finalContent = previewContent.replace(
      "blob:preview",
      "https://cdn.builder.io/api/v1/image/assets%2Fphoto",
    );
    const slide = {
      id: "slide-image-upload",
      content: previewContent,
      layout: "blank",
    } as Slide;
    const { rerender } = render(<SlideInner slide={slide} />);
    const image = document.querySelector<HTMLImageElement>(
      '[data-slide-object-id="image-1"]',
    );
    if (!image) throw new Error("expected preview image");
    image.style.left = "184px";

    rerender(
      <SlideInner slide={{ ...slide, content: finalContent } as Slide} />,
    );

    await waitFor(() => {
      expect(image.getAttribute("src")).toBe(
        "https://cdn.builder.io/api/v1/image/assets%2Fphoto",
      );
    });
    expect(document.querySelector('[data-slide-object-id="image-1"]')).toBe(
      image,
    );
    expect(image.style.left).toBe("184px");
  });

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
        if (this.classList.contains("layout-wrapper")) {
          return rect(110, 80, 740, 500);
        }
        if (this.classList.contains("inner-content")) {
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
      expect(fitLayer?.style.getPropertyValue("--fmd-fit-scale")).toBe("1");
      expect(fitLayer?.getAttribute("data-fmd-autofit-active")).toBeNull();
      expect(onOverflowChange).toHaveBeenCalledWith(
        expect.objectContaining({ verticalOverflow: 120 }),
      );
    });
  });

  it("ignores a spilling flow wrapper when its inner content fits", async () => {
    const slide: Slide = {
      id: "wrapper-spill",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide"><div class="layout-wrapper"><div class="inner-content">Fits</div></div></div>',
    };

    const onOverflowChange = vi.fn();
    render(<SlideInner slide={slide} onOverflowChange={onOverflowChange} />);

    await waitFor(() => {
      expect(onOverflowChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          verticalOverflow: 0,
          horizontalOverflow: 0,
        }),
      );
    });
  });

  it("measures direct text in a container instead of skipping its children", async () => {
    const slide: Slide = {
      id: "visible-container",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide"><div class="visible-container">Visible label <div class="inner-content">Fits</div></div></div>',
    };

    const onOverflowChange = vi.fn();
    render(<SlideInner slide={slide} onOverflowChange={onOverflowChange} />);

    await waitFor(() => {
      expect(onOverflowChange).toHaveBeenLastCalledWith(
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

  it("uses the neutral fallback background when no design system is linked", () => {
    const slide: Slide = {
      id: "neutral-fallback",
      layout: "blank",
      notes: "",
      content: '<div class="fmd-slide"><h1>Readable by default</h1></div>',
    };

    render(<SlideInner slide={slide} />);

    expect(
      document.querySelector<HTMLElement>(
        '[data-slide-canvas="neutral-fallback"]',
      )?.style.background,
    ).toBe("#FFFFFF");
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

  it("keeps a converted leading Markdown image in the Markdown layout path", () => {
    const slide: Slide = {
      id: "markdown-image-layout",
      layout: "two-column",
      notes: "",
      content:
        '<img data-markdown-image="true" src="https://cdn.example.com/chart.png" alt="Chart" style="display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover;">\n\n---\n\nRight column',
    };

    render(<SlideInner slide={slide} />);

    const canvas = document.querySelector<HTMLElement>(
      `[data-slide-canvas="${slide.id}"]`,
    );
    expect(canvas?.className).toContain("px-16");
    expect(canvas?.querySelectorAll(".slide-content")).toHaveLength(2);
  });

  it.each([
    ['<div style="color:#292524">x</div>', true],
    ["<div style='COLOR: red'>x</div>", true],
    ['# Title\n\n<p style="margin:0; color: rgb(1,2,3)">x</p>', true],
    ['<div style="background-color:#fdf6ec">x</div>', false],
    ['<div style="border-color: red">x</div>', false],
    ['<div style="--brand-color: red">x</div>', false],
    ["Prose that mentions color: red without markup", false],
    ["# Title\n\nPlain body", false],
  ])("slideDeclaresTextColor(%j) === %s", (html, expected) => {
    expect(slideDeclaresTextColor(html as string)).toBe(expected);
  });

  it("turns the palette off for a markdown layout whose slide declares colors", () => {
    const slide: Slide = {
      id: "markdown-authored-colors",
      layout: "content",
      notes: "",
      content:
        '# Onboarding New Customers\n\n<div style="background: #fdf6ec; color: #292524">Body copy</div>',
    };

    render(<SlideInner slide={slide} />);

    const pane = document.querySelector<HTMLElement>(
      `[data-slide-canvas="${slide.id}"] .slide-content`,
    );
    expect(pane?.getAttribute("data-slide-content-scope")).toBe(
      "authored-colors",
    );
  });

  it("keeps the palette on for a markdown slide that declares no colors", () => {
    const slide: Slide = {
      id: "markdown-plain",
      layout: "content",
      notes: "",
      content: "# Title\n\nBody copy with a **bold** word.",
    };

    render(<SlideInner slide={slide} />);

    const pane = document.querySelector<HTMLElement>(
      `[data-slide-canvas="${slide.id}"] .slide-content`,
    );
    expect(pane?.hasAttribute("data-slide-content-scope")).toBe(false);
  });

  it("turns the palette off per column for an authored-color two-column slide", () => {
    const slide: Slide = {
      id: "two-column-authored-colors",
      layout: "two-column",
      notes: "",
      content:
        'Plain left column\n\n---\n\n<div style="color: #292524">Recolored right column</div>',
    };

    render(<SlideInner slide={slide} />);

    const panes = document.querySelectorAll<HTMLElement>(
      `[data-slide-canvas="${slide.id}"] .slide-content`,
    );
    expect(panes).toHaveLength(2);
    expect(panes[0].hasAttribute("data-slide-content-scope")).toBe(false);
    expect(panes[1].getAttribute("data-slide-content-scope")).toBe(
      "authored-colors",
    );
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

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(fitLayer?.style.getPropertyValue("--fmd-fit-scale")).toBe("0.74");
  });

  it("keeps the live edit node on a mermaid slide across re-renders", () => {
    const slide: Slide = {
      id: "raw-mermaid",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide"><h2>Diagram title</h2><div class="mermaid">graph TD; A--&gt;B;</div></div>',
    };

    const { rerender } = render(<SlideInner slide={slide} />);

    const heading = document.querySelector<HTMLElement>("h2");
    expect(heading).toBeTruthy();
    heading!.contentEditable = "true";

    rerender(<SlideInner slide={slide} />);

    expect(document.querySelector("h2")).toBe(heading);
  });

  it("renders a mermaid diagram in place inside the slide root", async () => {
    const slide: Slide = {
      id: "raw-mermaid-inside",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide"><h2>Diagram title</h2><div class="mermaid">graph TD; A--&gt;B;</div><p>Caption below</p></div>',
    };

    render(<SlideInner slide={slide} />);

    const fmdSlide = document.querySelector(".fmd-slide")!;
    expect(document.querySelectorAll(".fmd-slide")).toHaveLength(1);
    expect(fmdSlide.querySelector("p")?.textContent).toBe("Caption below");
    const placeholder = fmdSlide.querySelector("[data-mermaid-index]")!;
    expect(placeholder).toBeTruthy();
    await waitFor(() =>
      expect(placeholder.querySelector("[data-mermaid-diagram]")).toBeTruthy(),
    );
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

  it("reports finite fit geometry for Excalidraw slides", async () => {
    const onOverflowChange = vi.fn();
    const onAutofitSettled = vi.fn();
    render(
      <SlideInner
        slide={{
          id: "excalidraw-fit",
          layout: "blank",
          notes: "",
          content: "",
          excalidrawData: '{"elements":[{"type":"rectangle"}]}',
        }}
        onOverflowChange={onOverflowChange}
        onAutofitSettled={onAutofitSettled}
      />,
    );

    await waitFor(() => {
      expect(onOverflowChange).toHaveBeenCalledWith({
        contentHeight: 540,
        contentWidth: 960,
        viewportHeight: 540,
        viewportWidth: 960,
        verticalOverflow: 0,
        horizontalOverflow: 0,
      });
      expect(onAutofitSettled).toHaveBeenCalled();
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

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(document.querySelector("[data-fmd-autofit-content]")).toBeNull();

    notify?.([{ isIntersecting: true }]);

    await waitFor(() => {
      expect(
        document.querySelector("[data-fmd-autofit-content]"),
      ).not.toBeNull();
    });
  });

  it("measures an off-screen slide mounted in the PDF export stage", async () => {
    let observerConstructed = false;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor() {
          observerConstructed = true;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => rect(0, 100_000, 740, 380),
    );

    const slide: Slide = {
      id: "raw-export-stage",
      layout: "blank",
      notes: "",
      content:
        '<div class="fmd-slide" style="padding: 80px 110px;"><h2>Flow title</h2></div>',
    };
    render(
      <div data-pdf-export-stage="true">
        <SlideInner slide={slide} />
      </div>,
    );

    await waitFor(() => {
      expect(
        document.querySelector("[data-fmd-autofit-content]"),
      ).not.toBeNull();
    });
    expect(observerConstructed).toBe(false);
  });
});

describe("imported deck webfonts", () => {
  const appendedToHead: HTMLElement[] = [];

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
    appendedToHead.length = 0;
    vi.spyOn(document.head, "appendChild").mockImplementation(((
      node: HTMLElement,
    ) => {
      appendedToHead.push(node);
      return node;
    }) as typeof document.head.appendChild);
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
    expect(resolveImportedFont("Open Sans")?.href).toBe(
      "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap",
    );
  });

  it("serves the shared picker's JetBrains Mono family", () => {
    expect(resolveImportedFont("JetBrains Mono")?.href).toBe(
      "https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap",
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
    expect(html).toContain("font-family:'Helvetica Neue', sans-serif");
    expect(hrefs).toEqual([
      "https://fonts.googleapis.com/css2?family=Work+Sans:ital,wght@0,100..900;1,100..900&display=swap",
    ]);
  });

  it("rewrites CSSOM-serialized double-quoted picker values", () => {
    const { html, hrefs } = prepareImportedFonts(
      `<span style='font-family: "Playfair Display", serif;'>a</span>`,
    );

    expect(html).toContain('font-family: "Playfair Display", serif');
    expect(hrefs).toEqual([
      "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap",
    ]);
  });

  it("loads the stylesheet for a rendered imported slide", async () => {
    const slide: Slide = {
      id: "imported-fonts",
      layout: "blank",
      notes: "",
      content: `<div class="fmd-slide fmd-imported-pptx" style="font-family: 'Yanone Kaffeesatz', sans-serif;">Brand</div>`,
    };
    render(<SlideInner slide={slide} />);

    await waitFor(() => {
      expect(
        appendedToHead.some(
          (node) =>
            node instanceof HTMLLinkElement &&
            node.rel === "stylesheet" &&
            node.href.includes("Yanone+Kaffeesatz"),
        ),
      ).toBe(true);
    });
  });
});
