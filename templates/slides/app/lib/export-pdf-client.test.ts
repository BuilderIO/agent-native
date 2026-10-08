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
    internal = { scaleFactor: 96 / 72 };
    output = () => new Blob();
    setFontSize = mocks.setFontSize;
    setTextColor = vi.fn();
    text = mocks.text;
  },
}));

vi.mock("modern-screenshot", () => ({ domToJpeg: mocks.domToJpeg }));

import {
  exportDeckAsPdf,
  findSlideExportSource,
  imageProxyUrl,
} from "./export-pdf-client.js";

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

  afterEach(() => {
    document.head
      .querySelectorAll<HTMLStyleElement>("[data-pdf-export-font-faces]")
      .forEach((style) => style.remove());
    document.head
      .querySelectorAll<HTMLLinkElement>('link[data-pdf-export-test="font"]')
      .forEach((link) => link.remove());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubRangeLayout() {
    const create = document.createRange.bind(document);
    const rect = { width: 400, height: 40, left: 60, top: 80 } as DOMRect;
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = create();
      range.getBoundingClientRect = () => rect;
      range.getClientRects = () =>
        Object.assign([rect], { item: () => rect }) as unknown as DOMRectList;
      return range;
    });
  }

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

  it("makes loaded Google Font CSS readable during raster capture", async () => {
    const fontCss =
      '@font-face { font-family: "Geist"; src: url(https://fonts.gstatic.com/geist.woff2); }';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fontCss,
    });
    vi.stubGlobal("fetch", fetchMock);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.pdfExportTest = "font";
    link.href = "https://fonts.googleapis.com/css2?family=Geist";
    const querySelectorAll = document.querySelectorAll.bind(document);
    vi.spyOn(document, "querySelectorAll").mockImplementation((selector) => {
      if (selector === 'link[rel~="stylesheet"][href]') {
        return [link] as unknown as NodeListOf<Element>;
      }
      return querySelectorAll(selector);
    });
    mocks.domToJpeg.mockImplementationOnce(async () => {
      expect(
        document.querySelector("[data-pdf-export-font-faces]")?.textContent,
      ).toContain(fontCss);
      return "data:image/jpeg;base64,AA==";
    });
    renderSlide("s1");

    await exportDeckAsPdf("Q3 review", [{ id: "s1", content: "<div></div>" }]);

    expect(fetchMock).toHaveBeenCalledWith(
      link.href,
      expect.objectContaining({ credentials: "omit", mode: "cors" }),
    );
    expect(document.querySelector("[data-pdf-export-font-faces]")).toBeNull();
  });

  it("cleans up temporary font styles when stylesheet loading is cancelled", async () => {
    const fontCss =
      '@font-face { font-family: "Geist"; src: url(https://fonts.gstatic.com/geist.woff2); }';
    const controller = new AbortController();
    const firstLink = document.createElement("link");
    firstLink.rel = "stylesheet";
    firstLink.href = "https://fonts.googleapis.com/css2?family=Geist";
    const secondLink = document.createElement("link");
    secondLink.rel = "stylesheet";
    secondLink.href = "https://fonts.googleapis.com/css2?family=Inter";
    const querySelectorAll = document.querySelectorAll.bind(document);
    vi.spyOn(document, "querySelectorAll").mockImplementation((selector) => {
      if (selector === 'link[rel~="stylesheet"][href]') {
        return [firstLink, secondLink] as unknown as NodeListOf<Element>;
      }
      return querySelectorAll(selector);
    });
    let releaseFirstText!: (cssText: string) => void;
    const fetchMock = vi.fn((href: string) => {
      if (href.endsWith("Geist")) {
        return Promise.resolve({
          ok: true,
          text: () =>
            new Promise<string>((resolve) => {
              releaseFirstText = resolve;
            }),
        });
      }
      controller.abort();
      return new Promise<never>((_, reject) => {
        queueMicrotask(() => reject(new Error("stylesheet request aborted")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSlide("s1");

    await expect(
      exportDeckAsPdf(
        "Q3 review",
        [{ id: "s1", content: "<div></div>" }],
        undefined,
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    releaseFirstText(fontCss);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("[data-pdf-export-font-faces]")).toBeNull();
  });

  it("cleans up temporary font styles when font readiness is cancelled", async () => {
    const fontCss =
      '@font-face { font-family: "Geist"; src: url(https://fonts.gstatic.com/geist.woff2); }';
    const controller = new AbortController();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.pdfExportTest = "font";
    link.href = "https://fonts.googleapis.com/css2?family=Geist";
    const querySelectorAll = document.querySelectorAll.bind(document);
    vi.spyOn(document, "querySelectorAll").mockImplementation((selector) => {
      if (selector === 'link[rel~="stylesheet"][href]') {
        return [link] as unknown as NodeListOf<Element>;
      }
      return querySelectorAll(selector);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => fontCss,
      }),
    );
    let releaseSecondReady!: () => void;
    const originalFonts = document.fonts;
    const secondReadyStarted = new Promise<void>((resolve) => {
      releaseSecondReady = resolve;
    });
    let readyCalls = 0;
    const fonts = {};
    Object.defineProperty(fonts, "ready", {
      get: () => {
        readyCalls += 1;
        if (readyCalls === 2) releaseSecondReady();
        return readyCalls === 1
          ? Promise.resolve()
          : new Promise<void>(() => {});
      },
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fonts,
    });
    renderSlide("s1");

    try {
      const exportPromise = exportDeckAsPdf(
        "Q3 review",
        [{ id: "s1", content: "<div></div>" }],
        undefined,
        { signal: controller.signal },
      );
      await secondReadyStarted;
      controller.abort(new Error("PDF export cancelled"));
      await expect(exportPromise).rejects.toThrow("PDF export cancelled");
      expect(document.querySelector("[data-pdf-export-font-faces]")).toBeNull();
    } finally {
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: originalFonts,
      });
    }
  });

  it("still writes a text layer for a slide measured from a sidebar thumbnail", async () => {
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

  it("keeps export-stage text in the PDF text layer", async () => {
    const stage = document.createElement("div");
    stage.setAttribute("aria-hidden", "true");
    stage.setAttribute("data-pdf-export-stage", "true");
    const canvas = renderSlide("s1");
    stage.appendChild(canvas);
    document.body.appendChild(stage);
    stubRangeLayout();

    await exportDeckAsPdf("Q3 review", [{ id: "s1", content: "<div></div>" }]);

    expect(mocks.text.mock.calls.map(([value]) => value)).toContain(
      "Growth & margin",
    );
  });

  it("does not wait on terminal renderer placeholders", async () => {
    const stage = document.createElement("div");
    stage.setAttribute("data-pdf-export-stage", "true");
    const canvas = renderSlide("s1");
    const mermaid = document.createElement("div");
    mermaid.setAttribute("data-mermaid-index", "0");
    mermaid.setAttribute("data-mermaid-state", "empty");
    canvas.appendChild(mermaid);
    stage.appendChild(canvas);
    document.body.appendChild(stage);

    await exportDeckAsPdf("Q3 review", [{ id: "s1", content: "<div></div>" }]);

    expect(mocks.addImage).toHaveBeenCalledTimes(1);
  });

  it("authorizes public-share image proxy URLs with the share token", () => {
    expect(
      imageProxyUrl("https://cdn.example.com/hero.png", "share-token"),
    ).toContain("shareToken=share-token");
  });

  it("keeps exporting when a same-origin image cannot decode", async () => {
    const canvas = renderSlide("s1");
    const image = document.createElement("img");
    image.src = "/missing.png";
    image.decode = vi.fn().mockRejectedValue(new Error("404"));
    canvas.appendChild(image);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await exportDeckAsPdf("Q3 review", [{ id: "s1", content: "<div></div>" }]);

    expect(mocks.addImage).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves speaker notes out of the PDF", async () => {
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
    expect(drawn).toContain("We’re up — a lot");
    for (const [, , , options] of mocks.text.mock.calls) {
      expect(options.renderingMode).toBe("invisible");
    }
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
    expect(full).toBeCloseTo(64 * (96 / 72), 3);
  });

  it("does not download after capture is cancelled", async () => {
    renderSlide("s1");
    const controller = new AbortController();
    mocks.domToJpeg.mockImplementationOnce(async () => {
      controller.abort();
      return "data:image/jpeg;base64,AA==";
    });

    await expect(
      exportDeckAsPdf(
        "Q3 review",
        [{ id: "s1", content: "<div></div>" }],
        undefined,
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(mocks.addImage).not.toHaveBeenCalled();
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
