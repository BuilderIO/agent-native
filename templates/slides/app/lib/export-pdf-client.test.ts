import {
  SLIDES_PDF_SIDECAR_MAX_JSON_BYTES,
  SLIDES_PDF_SIDECAR_NAMESPACE,
} from "@shared/pdf-sidecar";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addImage: vi.fn(),
  addMetadata: vi.fn(),
  addPage: vi.fn(),
  domToJpeg: vi.fn(async () => "data:image/jpeg;base64,AA=="),
  link: vi.fn(),
  setFontSize: vi.fn(),
  text: vi.fn(),
}));

vi.mock("jspdf", () => ({
  jsPDF: class {
    addImage = mocks.addImage;
    addMetadata = mocks.addMetadata;
    addPage = mocks.addPage;
    link = mocks.link;
    // jsPDF's px unit: coordinates are scaled by 96/72, font sizes are not.
    internal = { scaleFactor: 96 / 72 };
    output = () => new Blob();
    setFontSize = mocks.setFontSize;
    setTextColor = vi.fn();
    text = mocks.text;
  },
}));

vi.mock("modern-screenshot", () => ({ domToJpeg: mocks.domToJpeg }));

import { exportDeckAsPdf, findSlideExportSource } from "./export-pdf-client.js";

/**
 * A slide renders twice — sidebar thumbnail and editor canvas — with the same
 * layout width, distinguished only by a CSS `scale()`. `offsetWidth` does not
 * see transforms, so both read the same number and a strict `>` tiebreak
 * silently returned the document-order-first thumbnail, exporting the
 * low-fidelity copy. happy-dom reports 0 for every layout metric, so the
 * widths are stubbed per element to model the real DOM.
 */
function addSlideCopy(
  slideId: string,
  {
    offsetWidth,
    renderedWidth,
  }: { offsetWidth: number; renderedWidth: number },
) {
  const el = document.createElement("div");
  el.setAttribute("data-slide-canvas", slideId);
  Object.defineProperty(el, "offsetWidth", {
    value: offsetWidth,
    configurable: true,
  });
  el.getBoundingClientRect = () => ({ width: renderedWidth }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe("findSlideExportSource", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers the visually larger copy when both report the same offsetWidth", () => {
    // Thumbnail is first in document order — the order the old tiebreak kept.
    const thumbnail = addSlideCopy("s1", {
      offsetWidth: 960,
      renderedWidth: 192,
    });
    const canvas = addSlideCopy("s1", {
      offsetWidth: 960,
      renderedWidth: 960,
    });

    const picked = findSlideExportSource("s1", 0, 1);
    expect(picked).toBe(canvas);
    expect(picked).not.toBe(thumbnail);
  });

  it("still prefers the canvas when the editor is zoomed out", () => {
    addSlideCopy("s1", { offsetWidth: 960, renderedWidth: 192 });
    const zoomedCanvas = addSlideCopy("s1", {
      offsetWidth: 960,
      renderedWidth: 634,
    });

    expect(findSlideExportSource("s1", 0, 1)).toBe(zoomedCanvas);
  });

  it("falls back to offsetWidth when rendered widths genuinely tie", () => {
    addSlideCopy("s1", { offsetWidth: 480, renderedWidth: 480 });
    const larger = addSlideCopy("s1", {
      offsetWidth: 960,
      renderedWidth: 480,
    });

    expect(findSlideExportSource("s1", 0, 1)).toBe(larger);
  });

  it("throws rather than exporting a partial deck when the slide is not rendered", () => {
    expect(() => findSlideExportSource("missing", 2, 5)).toThrow(
      /Slide 3 of 5 is not currently rendered/,
    );
  });

  it("can restrict lookup to a dedicated export stage", () => {
    const stage = document.createElement("div");
    const canvas = addSlideCopy("s1", {
      offsetWidth: 960,
      renderedWidth: 960,
    });
    stage.appendChild(canvas);
    document.body.appendChild(stage);

    expect(findSlideExportSource("s1", 0, 1, stage)).toBe(canvas);
  });
});

/**
 * The export writes three things per deck and each one is load-bearing: the
 * page raster (what the PDF looks like), an invisible text layer (what a
 * reader, a search box, or a foreign PDF parser can recover), and the deck
 * sidecar (what makes re-importing this PDF give back the original editable
 * slides instead of a picture of them).
 */
describe("exportDeckAsPdf", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mocks.addImage.mockClear();
    mocks.addMetadata.mockClear();
    mocks.text.mockClear();
    mocks.link.mockClear();
    mocks.setFontSize.mockClear();
    mocks.domToJpeg.mockClear();
  });

  // stubRangeLayout spies on document.createRange and calls through; without a
  // restore, the next test's spy wraps the previous one and recurses forever.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * happy-dom has no layout engine, so a Range measures 0x0 and every text run
   * would be skipped as unrendered. Stub the one measurement the text layer
   * takes, the way the sibling tests above stub element widths.
   */
  function stubRangeLayout() {
    const create = document.createRange.bind(document);
    const rect = { width: 400, height: 40, left: 60, top: 80 } as DOMRect;
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = create();
      range.getBoundingClientRect = () => rect;
      // One rect = one rendered line, the shape the text layer measures.
      range.getClientRects = () =>
        Object.assign([rect], { item: () => rect }) as unknown as DOMRectList;
      return range;
    });
  }

  /**
   * `renderedScale` models the `scale(var(--slide-scale))` wrapper every slide
   * canvas renders inside: `getBoundingClientRect` sees through it, `clientWidth`
   * and `getComputedStyle().fontSize` do not.
   */
  function renderSlide(slideId: string, renderedScale = 1) {
    const canvas = document.createElement("div");
    canvas.setAttribute("data-slide-canvas", slideId);
    canvas.innerHTML = `<h1 style="font-size: 64px">Growth &amp; margin</h1><p>Revenue grew 42%</p><p>We’re up — a lot</p><p>売上高</p>`;
    Object.defineProperty(canvas, "offsetWidth", {
      value: 960,
      configurable: true,
    });
    Object.defineProperty(canvas, "clientWidth", {
      value: 960,
      configurable: true,
    });
    canvas.getBoundingClientRect = () =>
      ({
        width: 960 * renderedScale,
        height: 540 * renderedScale,
        left: 0,
        top: 0,
      }) as DOMRect;
    document.body.appendChild(canvas);
    return canvas;
  }

  it("embeds the deck source so the exported PDF re-imports as editable slides", async () => {
    renderSlide("s1");
    await exportDeckAsPdf(
      "Q3 review",
      [
        {
          id: "s1",
          content: '<div class="fmd-slide"><h1>Growth &amp; margin</h1></div>',
          notes: "Open with revenue.",
          layout: "title",
          transition: "fade" as const,
        },
      ],
      "16:9",
    );

    expect(mocks.addMetadata).toHaveBeenCalledTimes(1);
    const [payload, namespace] = mocks.addMetadata.mock.calls[0];
    expect(namespace).toBe(SLIDES_PDF_SIDECAR_NAMESPACE);
    expect(JSON.parse(atob(payload))).toEqual({
      v: 1,
      title: "Q3 review",
      aspectRatio: "16:9",
      slides: [
        {
          content: '<div class="fmd-slide"><h1>Growth &amp; margin</h1></div>',
          layout: "title",
          transition: "fade",
        },
      ],
    });
  });

  it("still writes a text layer for a slide measured from a sidebar thumbnail", async () => {
    // Inside the scaled, contained thumbnail subtree Chrome measures every
    // Range as 0x0 while element boxes still measure. Every slide but the one
    // open in the editor exports from a thumbnail, so a Range-only measurement
    // silently limited the text layer to page 1.
    const canvas = renderSlide("s1");
    const create = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = create();
      const empty = { width: 0, height: 0, left: 0, top: 0 } as DOMRect;
      range.getBoundingClientRect = () => empty;
      range.getClientRects = () =>
        Object.assign([], { item: () => null }) as unknown as DOMRectList;
      return range;
    });
    for (const el of Array.from(canvas.querySelectorAll("h1, p"))) {
      el.getBoundingClientRect = () =>
        ({ width: 300, height: 30, left: 40, top: 50 }) as DOMRect;
    }

    await exportDeckAsPdf("Q3 review", [{ id: "s1", content: "<div></div>" }]);

    expect(mocks.text.mock.calls.map(([value]) => value)).toContain(
      "Growth & margin",
    );
  });

  it("leaves speaker notes out of the PDF", async () => {
    // A PDF is the artifact people forward. Notes are private commentary the
    // page never shows, and every other share surface blanks them.
    renderSlide("s1");
    await exportDeckAsPdf("Q3 review", [
      { id: "s1", content: "<div></div>", notes: "Don't mention the layoffs." },
    ]);

    const [payload] = mocks.addMetadata.mock.calls[0];
    expect(atob(payload)).not.toContain("layoffs");
  });

  it("writes the slide's own words into the page as invisible text", async () => {
    renderSlide("s1");
    stubRangeLayout();
    await exportDeckAsPdf("Q3 review", [{ id: "s1", content: "<div></div>" }]);

    const drawn = mocks.text.mock.calls.map(([value]) => value);
    expect(drawn).toContain("Growth & margin");
    expect(drawn).toContain("Revenue grew 42%");
    // Curly quotes and dashes are CP1252, so a heading full of real typography
    // must not be dropped — that is most headings this app writes.
    expect(drawn).toContain("We’re up — a lot");
    for (const [, , , options] of mocks.text.mock.calls) {
      expect(options.renderingMode).toBe("invisible");
    }
    // jsPDF's built-in fonts are WinAnsi — a CJK run would be written as
    // replacement bytes, and text that extracts as mojibake is worse than text
    // that is absent. The sidecar carries it either way.
    expect(drawn).not.toContain("売上高");
  });

  it("preserves safe slide links as PDF annotations", async () => {
    const canvas = renderSlide("s1");
    const safeLink = document.createElement("a");
    safeLink.setAttribute("href", "https://example.com/docs");
    safeLink.textContent = "Read more";
    safeLink.getBoundingClientRect = () =>
      ({ width: 160, height: 24, left: 120, top: 90 }) as DOMRect;
    const unsafeLink = document.createElement("a");
    unsafeLink.setAttribute("href", "javascript:alert(1)");
    unsafeLink.textContent = "Unsafe";
    unsafeLink.getBoundingClientRect = () =>
      ({ width: 80, height: 24, left: 300, top: 90 }) as DOMRect;
    canvas.append(safeLink, unsafeLink);

    await exportDeckAsPdf("Q3 review", [{ id: "s1", content: "<div></div>" }]);

    expect(mocks.link).toHaveBeenCalledTimes(1);
    expect(mocks.link).toHaveBeenCalledWith(120, 90, 160, 24, {
      url: "https://example.com/docs",
    });
  });

  it("clips link annotations to the rendered slide bounds", async () => {
    const canvas = renderSlide("s1");
    const link = document.createElement("a");
    link.setAttribute("href", "https://example.com/docs");
    link.textContent = "Read more";
    link.getBoundingClientRect = () =>
      ({ width: 120, height: 40, left: 900, top: 520 }) as DOMRect;
    canvas.append(link);

    await exportDeckAsPdf("Q3 review", [{ id: "s1", content: "<div></div>" }]);

    expect(mocks.link).toHaveBeenCalledWith(900, 520, 60, 20, {
      url: "https://example.com/docs",
    });
  });

  it("sizes the text layer from the slide's own layout, not its on-screen scale", async () => {
    // Every slide canvas renders inside a `scale(var(--slide-scale))` wrapper,
    // so the same deck exports from a quarter-scale thumbnail and a full-size
    // canvas. The PDF page is the same size either way, so the type must be
    // too — sizing off the transform-inclusive rect wrote headings four times
    // too large from the sidebar.
    async function headingFontSize(renderedScale: number) {
      document.body.innerHTML = "";
      mocks.setFontSize.mockClear();
      mocks.text.mockClear();
      renderSlide("s1", renderedScale);
      stubRangeLayout();
      await exportDeckAsPdf("Q3 review", [
        { id: "s1", content: "<div></div>" },
      ]);
      const index = mocks.text.mock.calls.findIndex(
        ([value]) => value === "Growth & margin",
      );
      expect(index).toBeGreaterThanOrEqual(0);
      vi.restoreAllMocks();
      return mocks.setFontSize.mock.calls[index][0] as number;
    }

    const full = await headingFontSize(1);
    expect(await headingFontSize(0.25)).toBeCloseTo(full, 3);
    // jsPDF passes setFontSize straight through as points while scaling
    // coordinates by the px unit factor, so the size has to carry it by hand.
    expect(full).toBeCloseTo(64 * (96 / 72), 3);
  });

  it("still exports, without a sidecar, when the deck source is too large to carry", async () => {
    renderSlide("s1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await exportDeckAsPdf("Q3 review", [
      { id: "s1", content: "x".repeat(SLIDES_PDF_SIDECAR_MAX_JSON_BYTES + 1) },
    ]);

    expect(mocks.addImage).toHaveBeenCalledTimes(1);
    expect(mocks.addMetadata).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
